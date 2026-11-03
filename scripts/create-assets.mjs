import fs from 'node:fs/promises'
import path from 'node:path'
const icons = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18M8 15h1m6 0h1m-8 3h1"/>',
  news: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 7h10M7 11h10M7 15h4m-4 3h10"/>',
  trophy: '<path d="M8 3h8v6a4 4 0 0 1-8 0zM8 5H4v3a4 4 0 0 0 5 4m7-7h4v3a4 4 0 0 1-5 4m-3 1v5m-4 3h8m-7-3h6"/>',
  user: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  search: '<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  external: '<path d="M6 18 18 6M6 6h12v12"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  down: '<path d="m5 9 7 7 7-7"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  bell: '<path d="M5 17h14l-2-4V8a5 5 0 0 0-10 0v5zM10 21h4"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  heart: '<path d="M20.5 5a5 5 0 0 0-8.5 1 5 5 0 0 0-8.5-1C-1 11 8 17 12 21c4-4 13-10 8.5-16Z"/>',
  users: '<circle cx="9" cy="7" r="3.5"/><path d="M2 21v-2a7 7 0 0 1 14 0v2m1-18a4 4 0 0 1 0 8m2 3a5 5 0 0 1 3 5v2"/>',
  bracket: '<path d="M3 4h5v6H3m0 10h5v-6H3m5-7h6v10H8m6-5h7"/>',
  check: '<path d="m5 12 4 4L20 5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  ball: '<circle cx="12" cy="12" r="9"/><path d="m12 8 4 3-1.5 5h-5L8 11zM12 3v5m9 2-5 1m2 8-3.5-3m-8.5 3 3.5-3M3 10l5 1"/>',
  flag: '<path d="M5 22V3c5-4 9 4 14 0v10c-5 4-9-4-14 0"/>',
}
const colors = { ink: '#233e32', green: '#21754f', white: '#ffffff', muted: '#88968e', gold: '#b99545' }
const { createCanvas, loadImage } = await import(path.join(process.env.HOME, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas/index.js'))
async function raster(svg, width, height, filename) {
  const image = await loadImage(Buffer.from(svg))
  const canvas = createCanvas(width, height)
  canvas.getContext('2d').drawImage(image, 0, 0, width, height)
  await fs.writeFile(filename, canvas.toBuffer('image/png'))
}
for (const [name, body] of Object.entries(icons)) for (const [tone, color] of Object.entries(colors)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
  await raster(svg, 72, 72, `src/static/icons/${name}-${tone}.png`)
}
const badges = [ ['jiangwan','#176b46','JW','2019',0], ['xuhui','#c2533e','XH','2020',1], ['pudong','#326ca0','PD','2018',2], ['putuo','#9a6349','PT','2021',3], ['songjiang','#665398','SJ','2017',2], ['yangpu','#b68c38','YP','2021',1], ['minhang','#3c8389','MH','2019',0], ['jingan','#495d72','JA','2022',3] ]
for (const [id,color,initial,year,shape] of badges) {
  const outline = shape === 1 ? '<circle cx="50" cy="50" r="43"/>' : shape === 2 ? '<path d="M50 5 90 22v37L50 96 10 59V22Z"/>' : '<path d="M13 12h74v40c0 24-22 39-37 45C35 91 13 76 13 52Z"/>'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="106" viewBox="0 0 100 106"><g fill="${color}">${outline}</g><g fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1.5" transform="translate(7 7) scale(.86)">${outline}</g><path d="m50 20 2 5 5 .5-4 3 1 5-4-3-4 3 1-5-4-3 5-.5Z" fill="#e6d1a1"/><text x="50" y="61" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" font-weight="800" fill="#fff">${initial}</text><path d="M32 71h36" stroke="#fff" stroke-opacity=".5"/><text x="50" y="83" text-anchor="middle" font-family="Arial,sans-serif" font-size="10" letter-spacing="2" fill="#fff">${year}</text></svg>`
  await fs.writeFile(`src/static/teams/${id}.svg`, svg)
  await raster(svg, 180, 190, `src/static/teams/${id}.png`)
}
const brand = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><rect width="80" height="80" rx="24" fill="#18583d"/><g fill="none" stroke="#f1f6ed" stroke-width="2.5"><rect x="19" y="13" width="42" height="54" rx="3"/><path d="M19 40h42M29 13v10h22V13M29 67V57h22v10"/><circle cx="40" cy="40" r="8"/></g><circle cx="40" cy="40" r="2" fill="#d5e8a2"/></svg>'
await fs.writeFile('src/static/brand.svg', brand)
await raster(brand, 160, 160, 'src/static/brand.png')
console.log('Generated original brand, 8 team badges, and portable PNG icons.')
