import {dim2, vec2} from "tfw/core/math"
import {Subject, Value} from "tfw/core/react"
import {Renderer, Texture, TriangleBatch, TriangleBatchSource, makeTexture} from "tfw/scene2/gl"
import {Surface} from "tfw/scene2/surface"

const root = document.getElementById("root")
if (root) {
  const renderer = new Renderer({size: dim2.fromValues(root.offsetWidth, root.offsetHeight)})
  root.appendChild(renderer.canvas)

  const watS = Subject.derive<HTMLImageElement>(disp => {
    const wat = new Image()
    wat.src = "./wat.jpg"
    wat.onload = () => disp(wat)
    return () => {} // TODO: dispose image?
  })

  const batch = new TriangleBatch(renderer.glc, new TriangleBatchSource())
  const surf = new Surface(renderer.target, batch)

  const texS = Value.constant(Texture.DefaultConfig)
  const watT = makeTexture(renderer.glc, watS, texS)
  const pos = vec2.create(), size = dim2.create()
  watT.onValue(wat => {
    const render = (time :number) => {
      surf.begin()
      surf.clearTo(1, 0, 1, 1)
      const secs = time/1000
      const sin = Math.sin(secs), cos = Math.cos(secs)
      vec2.set(pos, 250+sin*50, 250+cos*50)
      dim2.set(size, wat.size[0]*cos, wat.size[1]*sin)
      surf.draw(wat, pos, size)
      surf.end()
      requestAnimationFrame(render)
    }
    requestAnimationFrame(render)
  })

} else {
  console.log(`No root?`)
}
