import assert from 'node:assert/strict';
import fs from 'node:fs';

const bridgePath = new URL('../yueji-stats-calendar.js', import.meta.url);
assert.ok(fs.existsSync(bridgePath), 'a dedicated stats calendar bridge must exist');
const source = fs.readFileSync(bridgePath, 'utf8');

assert.match(source, /data-page=["']analytics["']/, 'calendar must target the statistics page');
assert.match(source, /data-stats-tab=["']month["']/, 'monthly stats tab must own a month calendar');
assert.match(source, /data-stats-tab=["']year["']/, 'year stats tab must own the 12-month calendar');
assert.match(source, /unifiedYearCard/, 'legacy home calendar must be explicitly removed or relocated');
assert.match(source, /remove\(\)|removeChild|replaceChildren/, 'legacy home calendar must not remain on the home page');
assert.match(source, /statsCalendarCard/, 'statistics page must have a dedicated calendar card');
