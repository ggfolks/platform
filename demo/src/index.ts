import {mat2d} from "gl-matrix"
import * as R from "tfw-platform/core/react"
import * as G from "tfw-platform/scene2/gl"

const GLC = WebGLRenderingContext

const root = document.getElementById("root")
if (root) {
  const renderer = new G.Renderer({
    width: root.offsetWidth,
    height: root.offsetHeight
  })
  root.appendChild(renderer.canvas)

  const watS = R.Subject.derive<HTMLImageElement>(disp => {
    const wat = new Image()
    wat.src = "./wat.jpg"
    wat.onload = () => disp(wat)
    return () => {} // TODO: dispose image?
  })

  const batch = new G.TriangleBatch(renderer.glc, new G.TriangleBatchSource())

  const texS = R.Value.constant(G.DefaultTexConfig)
  const watT = G.makeTexture(renderer.glc, watS, texS)
  watT.onValue(wat => {
    setInterval(() => {
      requestAnimationFrame(() => {
        renderer.glc.clearColor(1, 0, 1, 1)
        renderer.glc.clear(GLC.COLOR_BUFFER_BIT)
        renderer.target.bind()
        batch.begin(renderer.target.width, renderer.target.height, renderer.target.flip)
        batch.addTexQuad(wat, 0xFFFFFFFF, mat2d.create(), 0, 0, wat.width, wat.height)
        batch.end()
      })
    }, 1000)
  })

} else {
  console.log(`No root?`)
}
