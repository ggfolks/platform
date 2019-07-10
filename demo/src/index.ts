import {dim2, vec2} from "tfw/core/math"
import {Clock, Loop} from "tfw/core/clock"
import {Color} from "tfw/core/color"
import {Subject, Value} from "tfw/core/react"
import {loadImage} from "tfw/core/assets"
import {GLC, Renderer, Texture, makeTexture, windowSize} from "tfw/scene2/gl"
import {QuadBatch, UniformQuadBatch} from "tfw/scene2/batch"
import {Surface} from "tfw/scene2/surface"
import {entityDemo} from "./entity"
import {spaceDemo} from "./space"

type RenderFn = (clock :Clock, batch :QuadBatch, surf :Surface) => void

const root = document.getElementById("root")
if (!root) throw new Error(`No root?`)

const renderer = new Renderer({
  // kind of a hack: when the window size changes, we emit an update with our div size;
  // browsers don't emit resize events for arbitrary divs (there's apparently a proposal, yay)
  size: windowSize(window).map(size => dim2.set(size, root.clientWidth, root.clientHeight)),
  scaleFactor: window.devicePixelRatio,
  gl: {alpha: true}
})
root.appendChild(renderer.canvas)

const batch = new UniformQuadBatch(renderer.glc)
const surf = new Surface(renderer.target, batch)

let renderfn :RenderFn = squares

const loop = new Loop()
loop.clock.onEmit(clock => {
  renderfn(clock, batch, surf)
})
loop.start()

// little demo renderer functions

const pos = vec2.create(), size = dim2.create()
const color = Color.fromRGB(1, 1, 1)

function squares (clock :Clock, _ :QuadBatch, surf :Surface) {
  surf.begin()
  const secs = clock.elapsed, sin = (Math.sin(secs)+1)/2, cos = (Math.cos(secs)+1)/2
  const vsize = renderer.size.current
  const sqSize = 16, hCount = Math.ceil(vsize[0]/sqSize), vCount = Math.ceil(vsize[1]/sqSize)
  dim2.set(size, sqSize, sqSize)
  for (let yy = 0; yy < vCount; yy += 1) {
    for (let xx = 0; xx < hCount; xx += 1) {
      const h = sin * xx * 360 / hCount, s = cos * yy/vCount
      surf.setFillColor(Color.setHSV(color, h, s, 1))
      surf.fillRect(vec2.set(pos, xx*size[0], yy*size[1]), size)
    }
  }
  surf.end()
}

function wat (glc :GLC) :Subject<RenderFn> {
  const watS = loadImage("https://i.imgur.com/uT5mXXG.jpg")
  const texS = Value.constant(Texture.DefaultConfig)
  const watT = makeTexture(glc, watS, texS)
  const pos = vec2.create(), size = dim2.create()
  return watT.map(wat => (clock, _, surf) => {
    const secs = clock.elapsed, sin = Math.sin(secs), cos = Math.cos(secs)
    vec2.set(pos, 250+sin*50, 250+cos*50)
    dim2.set(size, wat.size[0]*cos, wat.size[1]*sin)
    surf.begin()
    surf.clearTo(1, 1, 1, 1)
    surf.draw(wat, pos, size)
    surf.end()
  })
}

document.onkeydown = ev => {
  switch (ev.key) {
  case "1": renderfn = squares ; break
  case "2": wat(renderer.glc).onValue(r => renderfn = r) ; break
  case "3": entityDemo(renderer).onValue(r => renderfn = r) ; break
  case "4": spaceDemo(renderer).onValue(r => renderfn = r) ; break
  }
  if (!loop.active) loop.start()
}

document.onmousedown = ev => {
  if (ev.button == 0) {
    if (loop.active) loop.stop()
    else loop.start()
  }
}
