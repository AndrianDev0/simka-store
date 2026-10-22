import test from 'node:test';
import assert from 'node:assert/strict';
import { geolocationAddress, geolocateRequest } from '../lib/ip-geolocation.ts';
test('geolocation requires an explicitly trusted reverse proxy',()=>{
  assert.equal(geolocationAddress(new Request('https://simki.cc',{headers:{'x-real-ip':'8.8.8.8'}}),false),null);
});
test('geolocation ignores client-supplied country and forwarded headers',()=>{
  assert.equal(geolocationAddress(new Request('https://simki.cc',{headers:{'cf-connecting-ip':'8.8.8.8','x-forwarded-for':'8.8.8.8','x-country':'US'}}),true),null);
});
test('geolocation accepts public IPv4 and IPv6 only',()=>{
  for(const value of ['127.0.0.1','10.1.1.1','::1','fc00::1','8.8.8.8,1.1.1.1','bad','::ffff:127.0.0.1']) assert.equal(geolocationAddress(new Request('https://simki.cc',{headers:{'x-real-ip':value}}),true),null);
  for(const value of ['8.8.8.8','2001:4860:4860::8888']) assert.equal(geolocationAddress(new Request('https://simki.cc',{headers:{'x-real-ip':value}}),true),value);
});
test('missing geolocation configuration does not invent a location',async()=>{
  assert.deepEqual(await geolocateRequest(new Request('https://simki.cc')), {countryCode:null,region:null,city:null});
});
