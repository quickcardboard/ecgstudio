// The iOS app's version and build number, for a build going to App Store Connect: app/'s `npm run release:ios` (the build,
// `npx cap sync ios`, then this). Only then: the Xcode project changes, and that change is committed as the record of the
// release (`npm run sync:ios`, for the Simulator, leaves the project as it is).
// - version (MARKETING_VERSION, what the App Store shows): app/package.json's "version", the one number for the website,
//   Android (app/android/app/build.gradle reads it too) and iOS
// - build number (CURRENT_PROJECT_VERSION): the UTC date and time as YYMMDD.HHMM, so every build is higher than the last
//   (App Store Connect refuses a build number it has seen for that version)
// Usage: node tools/ios_version.js [app dir]   (default: app/ next to tools/)
const fs = require('fs'), path = require('path');
const appDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'app'));
const version = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version;
if (!/^\d+(\.\d+){0,2}$/.test(version)) throw new Error(`app/package.json version "${version}": iOS needs 1 to 3 numbers (1.2.3)`);
const d = new Date(), two = (n) => String(n).padStart(2, '0');
const build = `${two(d.getUTCFullYear() % 100)}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}.${two(d.getUTCHours())}${two(d.getUTCMinutes())}`;
const pbx = path.join(appDir, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
if (!fs.existsSync(pbx)) { console.log(`No iOS project at ${pbx} (npx cap add ios first): version not set`); process.exit(0); }
let s = fs.readFileSync(pbx, 'utf8');
const n = (s.match(/MARKETING_VERSION = [^;]*;/g) || []).length;
if (!n) throw new Error('MARKETING_VERSION not found in the Xcode project');
s = s.replace(/MARKETING_VERSION = [^;]*;/g, `MARKETING_VERSION = ${version};`)
     .replace(/CURRENT_PROJECT_VERSION = [^;]*;/g, `CURRENT_PROJECT_VERSION = ${build};`);
fs.writeFileSync(pbx, s);
console.log(`iOS: version ${version}, build ${build}`);
