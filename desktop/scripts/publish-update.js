// After `electron-builder --win`, puts the new installer where installed tills look for updates:
// ../public/till-updates/ (served at https://skinmatrixgh.web.app/till-updates/). Then build and deploy hosting:
//   cd .. && npm run build && firebase deploy --only hosting
// Only the newest installer is kept there. The folder is not in git (installers are large).
'use strict'
const fs = require('node:fs')
const path = require('node:path')

const { version } = require('../package.json')
const release = path.join(__dirname, '..', 'release')
const target = path.join(__dirname, '..', '..', 'public', 'till-updates')
const installer = `SkinMatrix-Till-Setup-${version}.exe`
const files = ['latest.yml', installer, `${installer}.blockmap`]

for (const name of files) if (!fs.existsSync(path.join(release, name))) throw new Error(`Missing ${name} in desktop/release. Build first.`)
const yml = fs.readFileSync(path.join(release, 'latest.yml'), 'utf8')
if (!yml.includes(`version: ${version}`)) throw new Error('latest.yml is not for this version.')

fs.mkdirSync(target, { recursive: true })
for (const name of fs.readdirSync(target)) if (!files.includes(name)) fs.rmSync(path.join(target, name))
for (const name of files) fs.copyFileSync(path.join(release, name), path.join(target, name))
console.log(`Till app ${version} ready in public/till-updates/. Now: cd .. && npm run build && firebase deploy --only hosting`)
