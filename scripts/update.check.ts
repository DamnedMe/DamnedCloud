// Self-check for the APK update comparison (src/lib/version.ts).
// Run: node --experimental-strip-types scripts/update.check.ts
import assert from 'node:assert/strict'
import { isNewer } from '../src/lib/version.ts'

assert.equal(isNewer('0.1.4', '0.1.3'), true)
assert.equal(isNewer('v0.1.10', '0.1.9'), true, 'numeric, not alphabetical; the tag prefix is ignored')
assert.equal(isNewer('0.2.0', '0.10.0'), false)
assert.equal(isNewer('0.1.3', '0.1.3'), false, 'same version: no offer')
assert.equal(isNewer('0.1.3', '0.1.4'), false, 'an older release never downgrades')
assert.equal(isNewer('1.0', '0.9.9'), true)
console.log('update.check ok')
