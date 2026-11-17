'use strict'
const { inflateSync } = require('node:zlib')
const { PNG } = require('pngjs')
const jpeg = require('jpeg-js')
const { fail, TeamBadgeError, MAX_BYTES } = require('./team-badge-model')
const MAX_EDGE = 2048, MAX_PIXELS = 4_000_000
function dimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_EDGE || height > MAX_EDGE || width * height > MAX_PIXELS) fail('INVALID_ARGUMENT', '图片边长不能超过2048像素，总像素不能超过400万。')
}
function checkPng(bytes) {
  if (bytes.length < 33 || !bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii',12,16) !== 'IHDR') fail('INVALID_ARGUMENT', 'PNG图片结构不完整。')
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
  dimensions(width,height)
  const depth = bytes[24], color = bytes[25], interlace = bytes[28], channels = {0:1,2:3,3:1,4:2,6:4}[color]
  if (!channels || !({0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]}[color]).includes(depth) || bytes[26] || bytes[27] || interlace > 1) fail('INVALID_ARGUMENT','PNG图片格式无效。')
  let offset = 8, ended = false; const chunks = []
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset), type = bytes.toString('ascii',offset+4,offset+8)
    if (size > bytes.length-offset-12 || type === 'IHDR' && offset !== 8) fail('INVALID_ARGUMENT','PNG图片损坏或被截断。')
    if (type === 'IDAT') chunks.push(bytes.subarray(offset+8,offset+8+size))
    offset += size + 12
    if (type === 'IEND') { if (size || offset !== bytes.length) fail('INVALID_ARGUMENT','PNG图片结束标记无效。'); ended = true; break }
  }
  if (!ended || !chunks.length) fail('INVALID_ARGUMENT','PNG图片缺少完整内容。')
  const passes = interlace ? [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]] : [[0,0,1,1]]
  let expected = 0
  for (const [x,y,dx,dy] of passes) { const w = width > x ? Math.ceil((width-x)/dx) : 0, h = height > y ? Math.ceil((height-y)/dy) : 0; if (w && h) expected += (Math.ceil(w*channels*depth/8)+1)*h }
  if (inflateSync(Buffer.concat(chunks),{maxOutputLength:expected}).length !== expected) fail('INVALID_ARGUMENT','PNG图片像素不完整。')
}
function validateTeamBadge(bytes, mime) {
  try {
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES) fail('INVALID_ARGUMENT','请选择不超过256KiB的JPG或PNG图片。')
    let image
    if (mime === 'image/png') { checkPng(bytes); image = PNG.sync.read(bytes,{checkCRC:true}) }
    else if (mime === 'image/jpeg') {
      if (!bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex')) || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) fail('INVALID_ARGUMENT','JPG图片格式不完整。')
      image = jpeg.decode(bytes,{useTArray:true,formatAsRGBA:true,tolerantDecoding:false,maxResolutionInMP:4,maxMemoryUsageInMB:32})
    } else fail('INVALID_ARGUMENT','仅支持JPG和PNG图片。')
    dimensions(image.width,image.height)
    if (image.data?.length !== image.width*image.height*4) fail('INVALID_ARGUMENT','图片像素不完整。')
    return {width:image.width,height:image.height}
  } catch (error) { if (error instanceof TeamBadgeError) throw error; fail('INVALID_ARGUMENT','图片损坏或无法解码，请重新选择JPG或PNG图片。') }
}
module.exports = { validateTeamBadge, MAX_EDGE, MAX_PIXELS }
