import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const publicPages = [
  ['ai-answering-service.html', 'https://ringandbooked.com/ai-answering-service'],
  ['after-hours-call-answering.html', 'https://ringandbooked.com/after-hours-call-answering'],
  ['ai-appointment-booking.html', 'https://ringandbooked.com/ai-appointment-booking'],
  ['ai-receptionist-for-service-businesses.html', 'https://ringandbooked.com/ai-receptionist-for-service-businesses'],
  ['how-ring-and-booked-works.html', 'https://ringandbooked.com/how-ring-and-booked-works'],
  ['after-hours-call-handling-checklist.html', 'https://ringandbooked.com/after-hours-call-handling-checklist'],
  ['service-business-call-forwarding-guide.html', 'https://ringandbooked.com/service-business-call-forwarding-guide'],
  ['ai-receptionist-onboarding-checklist.html', 'https://ringandbooked.com/ai-receptionist-onboarding-checklist']
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

test('resource hub has a canonical, one H1, and valid collection schema', () => {
  const html = read('resources.html');
  assert.equal((html.match(/<h1\b/gi) || []).length, 1);
  assert.match(html, /<link rel="canonical" href="https:\/\/ringandbooked\.com\/resources">/);
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.equal(blocks.length, 1);
  assert.equal(JSON.parse(blocks[0][1])['@type'], 'CollectionPage');
});

test('sitemap includes all public landing and resource pages and 404 page is present', () => {
  const sitemap = read('sitemap.xml');
  for (const [, canonical] of publicPages) assert.match(sitemap, new RegExp(`<loc>${canonical}</loc>`));
  assert.match(sitemap, /<loc>https:\/\/ringandbooked\.com\/resources<\/loc>/);
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

test('homepage, llms files, and resource hub link to the content system', () => {
  const homepage = read('index.html');
  const hub = read('resources.html');
  const llms = read('llms.txt');
  assert.match(homepage, /id="resources"/);
  assert.match(homepage, /href="\/resources"/);
  assert.match(homepage, /href="\/how-ring-and-booked-works"/);
  for (const path of ['/after-hours-call-handling-checklist', '/service-business-call-forwarding-guide', '/ai-receptionist-onboarding-checklist']) {
    assert.match(homepage, new RegExp(`href="${path}"`));
    assert.match(hub, new RegExp(`href="${path}"`));
    assert.match(llms, new RegExp(path));
  }
});

test('Supabase loads after page content but before account initialization', () => {
  const html = read('index.html');
  const sdk = html.indexOf('src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"');
  const body = html.indexOf('<body>');
  const initialization = html.indexOf('const CLIENT_CONFIG =');
  assert.ok(sdk > body, 'Supabase should not block initial document parsing from the head');
  assert.ok(sdk < initialization, 'Supabase must load before account initialization');
});
