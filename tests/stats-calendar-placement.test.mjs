import assert from 'node:assert/strict';
import fs from 'node:fs';

const bridgePath = new URL('../yueji-stats-calendar.js', import.meta.url);
assert.ok(fs.existsSync(bridgePath), 'a dedicated stats calendar bridge must exist');
const source = fs.readFileSync(bridgePath, 'utf8');

assert.match(source, /data-page=["']analytics["']/, 'calendar must target the statistics page');
assert.match(source, /activeStatsTab\(\)/, 'calendar visibility must follow the active statistics period');
assert.match(source, /unifiedYearCard/, 'the existing annual calendar node must be relocated instead of duplicated');
assert.match(source, /insertAdjacentElement\(['"]afterend['"],\s*annual\)/, 'the annual calendar must be physically moved into statistics');
assert.match(source, /annualCard\.hidden\s*=\s*tab\s*!==\s*['"]year['"]/, 'the annual calendar must only show on the year stats tab');
assert.match(source, /monthCard\.hidden\s*=\s*tab\s*!==\s*['"]month['"]/, 'the month calendar must only show on the month stats tab');
assert.match(source, /tab\s*!==\s*['"]month['"]\)\s*return/, 'all-time stats must not show a reading calendar');
assert.match(source, /statsCalendarCard/, 'statistics page must have a dedicated month calendar card');
