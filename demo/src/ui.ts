import {dim2, vec2} from "tfw/core/math"
import {Clock} from "tfw/core/clock"
import {Subject} from "tfw/core/react"
import {QuadBatch} from "tfw/scene2/batch"
import {Renderer, Texture, createTexture, imageToTexture} from "tfw/scene2/gl"
import {Surface} from "tfw/scene2/surface"
import {UI, Root, RootConfig} from "tfw/ui/ui"

type RenderFn = (clock :Clock, batch :QuadBatch, surf :Surface) => void

export function uiDemo (renderer :Renderer) :Subject<RenderFn> {
  return Subject.derive(disp => {
    const config = {
      type: "root",
      scale: renderer.scale,
      child: {
        type: "column",
        gap: 10,
        offPolicy: "stretch",
        children: [{
          type: "box",
          constraints: {stretch: true},
          background: {type: "solid", color: "#FFCC99"},
          child: {type: "column", children: []}
        }, {
          type: "box",
          constraints: {stretch: true},
          background: {type: "solid", color: "#99FFCC"},
          child: {type: "column", children: []}
        }, {
          type: "box",
          constraints: {stretch: true},
          background: {type: "solid", color: "#99CCFF"},
          child: {type: "column", children: []}
        }]
      }
    }

    const ui = new UI
    const root = new Root(ui, config as RootConfig)
    const canvas = root.pack(400, 400)
    const texcfg = {scale: renderer.scale, ...Texture.DefaultConfig}
    const gltex = createTexture(renderer.glc, texcfg)
    const tex = imageToTexture(renderer.glc, canvas, texcfg, gltex)

    const pos = vec2.fromValues(10, 10), size = dim2.fromValues(800, 800)
    disp((clock, batch, surf) => {
      surf.begin()
      surf.clearTo(1, 1, 1, 1)
      surf.draw(tex, pos, size)
      surf.end()
    })

    return () => {
      renderer.glc.deleteTexture(tex)
    }
  })
}
