import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const publicPages = [
  ['ai-answering-service.html', 'https://ringandbooked.com/ai-answering-service'],
  ['after-hours-call-answering.html', 'https://ringandbooked.com/after-hours-call-answering'],
  ['ai-appointment-booking.html', 'https://ringandbooked.com/ai-appointment-booking'],
  ['ai-receptionist-for-service-businesses.html', 'https://ringandbooked.com/ai-receptionist-for-service-businesses']
];

test('new public landing pages have one H1, canonical metadata, and valid JSON-LD', () => {
  for (const [file, canonical] of publicPages) {
    const html = read(file);
    assert.equal((html.match(/<h1\b/gi) || []).length, 1, `${file} should have one H1`);
    assert.match(html, new RegExp(`<link rel="canonical" href="${canonical}">`));
    const description = html.match(/<meta name="description" content="([^"]+)">/i)?.[1] || '';
    assert.ok(description.length >= 70 && description.length <= 165, `${file} description length`);
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    assert.equal(blocks.length, 2, `${file} schema count`);
    for (const block of blocks) JSON.parse(block[1]);
  }
});

test('sitemap includes all public landing pages and 404 page is present', () => {
  const sitemap = read('sitemap.xml');
  for (const [, canonical] of publicPages) assert.match(sitemap, new RegExp(`<loc>${canonical}</loc>`));
  const notFound = read('404.html');
  assert.match(notFound, /<meta name="robots" content="noindex">/);
  assert.match(notFound, /Page not found/);
});

test('homepage video structured data is valid and based on the embedded video', () => {
  const html = read('index.html');
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g)].map(match => JSON.parse(match[1]));
  const video = blocks.find(block => block['@type'] === 'VideoObject');
  assert.equal(video.embedUrl, 'https://www.youtube-nocookie.com/embed/4eVvqsl6CsI');
  assert.equal(video.uploadDate, '2026-09-27');
  assert.equal(video.duration, 'PT2M3S');
  assert.match(html, /href="\/ai-answering-service"/);
});
