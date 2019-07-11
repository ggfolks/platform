import {vec2} from "tfw/core/math"
import {Clock} from "tfw/core/clock"
import {Subject, Value} from "tfw/core/react"
import {QuadBatch} from "tfw/scene2/batch"
import {Renderer, Texture, createTexture, imageToTexture} from "tfw/scene2/gl"
import {Surface} from "tfw/scene2/surface"
import {UI, Root, RootConfig} from "tfw/ui/ui"

type RenderFn = (clock :Clock, batch :QuadBatch, surf :Surface) => void

const theme = {
  base: {
    font: {
      family: "Helvetica",
      size: 16
    },
    stroke: "#FFFFFF",
    fill: "#000000"
  },
  label: {
    parent: "base"
  },
  button: {
    parent: "base",
    padding: 5,
    background: {
      type: "solid",
      color: "#FFCC99"
    }
  }
}

const config = {
  type: "root",
  child: {
    type: "column",
    gap: 10,
    offPolicy: "stretch",
    children: [{
      type: "box",
      constraints: {stretch: true},
      background: {type: "solid", color: "#FFCC99"},
      child: {type: "label", text: Value.constant("Top"), font: {size: 32, weight: "bold"}}
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

export function uiDemo (renderer :Renderer) :Subject<RenderFn> {
  return Subject.derive(disp => {
    const ui = new UI(theme, {})
    const root = new Root(ui, {...config, scale: renderer.scale} as RootConfig)
    const canvas = root.pack(400, 400)
    const texcfg = {...Texture.DefaultConfig, scale: renderer.scale}
    const gltex = createTexture(renderer.glc, texcfg)
    const tex = imageToTexture(renderer.glc, canvas, texcfg, gltex)

    const pos = vec2.fromValues(10, 10)
    disp((clock, batch, surf) => {
      surf.begin()
      surf.clearTo(1, 1, 1, 1)
      surf.draw(tex, pos, tex.size)
      surf.end()
    })

    return () => {
      renderer.glc.deleteTexture(gltex)
    }
  })
}