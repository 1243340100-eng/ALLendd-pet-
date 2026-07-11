const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '..', '');
const mainSource = fs.readFileSync(path.join(appRoot, 'main.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(appRoot, 'renderer.js'), 'utf8');

function testNoBase64FallbackForKey() {
  assert.strictEqual(
    mainSource.includes("Buffer.from(apiKey, 'utf8').toString('base64')"),
    false,
    'API Key must not fall back to Base64 encoding when safeStorage is unavailable'
  );
  assert.strictEqual(
    mainSource.includes('sessionApiKey'),
    true,
    'sessionApiKey should be used as session-level store when safeStorage is unavailable'
  );
}

function testDecodeRejectsUnencrypted() {
  assert.strictEqual(
    mainSource.includes("return buffer.toString('utf8')"),
    false,
    'decodeApiKey must not decode Base64 fallback data'
  );
}

function testEndpointValidationExists() {
  assert.strictEqual(
    mainSource.includes('function validateEndpoint'),
    true,
    'validateEndpoint function should exist'
  );
  assert.strictEqual(
    mainSource.includes("url.protocol !== 'https:'"),
    true,
    'endpoint validation must require HTTPS'
  );
  assert.strictEqual(
    mainSource.includes('isLocalhost'),
    true,
    'localhost should be allowed as development exception'
  );
}

function testValidationCalledBeforeSave() {
  const validateIndex = mainSource.indexOf('validateEndpoint(');
  const saveIndex = mainSource.indexOf('atomicWriteJson(getApiConfigPath()');
  assert.ok(validateIndex >= 0, 'validateEndpoint should be called');
  assert.ok(saveIndex > validateIndex, 'validation should happen before atomic write');
}

function testReadApiConfigExposesEncryptionStatus() {
  assert.strictEqual(
    mainSource.includes('encryptionAvailable:'),
    true,
    'readApiConfig should expose encryptionAvailable so renderer can warn user'
  );
}

function testRendererShowsDomainChangeConfirmation() {
  assert.strictEqual(
    rendererSource.includes('endpointDomainChanged'),
    true,
    'renderer should have endpoint domain change confirmation text'
  );
  assert.strictEqual(
    rendererSource.includes('getHostnameFromUrl'),
    true,
    'renderer should extract hostname for comparison'
  );
}

function testRendererShowsEncryptionUnavailableWarning() {
  assert.strictEqual(
    rendererSource.includes('encryptionUnavailable'),
    true,
    'renderer should warn when encryption is unavailable'
  );
}

testNoBase64FallbackForKey();
console.log('PASS api-security: no Base64 fallback for API Key storage');
testDecodeRejectsUnencrypted();
console.log('PASS api-security: decode rejects unencrypted (Base64) data');
testEndpointValidationExists();
console.log('PASS api-security: endpoint HTTPS validation exists');
testValidationCalledBeforeSave();
console.log('PASS api-security: validation runs before saving config');
testReadApiConfigExposesEncryptionStatus();
console.log('PASS api-security: readApiConfig exposes encryption availability');
testRendererShowsDomainChangeConfirmation();
console.log('PASS api-security: renderer confirms endpoint domain change');
testRendererShowsEncryptionUnavailableWarning();
console.log('PASS api-security: renderer warns when encryption unavailable');
console.log('api security tests passed');
