/* eslint-disable @typescript-eslint/no-var-requires */
console.log('[MyCalendar] index loader loaded 1.6.7');

let joplin: any = null;
try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    joplin = require('api');
} catch (_e) {
    console.log('[MyCalendar] api module not available');
}

if (joplin) {
    const { default: runPlugin } = require('./main/pluginMain');
    runPlugin(joplin);
    console.log('[MyCalendar] runPlugin invoked');
} else {
    // мобільні збірки без API — тихо нічого не робимо
}
