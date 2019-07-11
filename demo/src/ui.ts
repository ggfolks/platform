import {vec2} from "tfw/core/math"
import {Clock} from "tfw/core/clock"
import {Subject, Mutable, Value} from "tfw/core/react"
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
      child: {type: "label", text: "top.text", font: {size: 32, weight: "bold"}}
    }, {
      type: "box",
      constraints: {stretch: true},
      background: {type: "solid", color: "#99FFCC"},
      child: {type: "label", text: "middle.text", font: {size: 24}}
    }, {
      type: "box",
      constraints: {stretch: true},
      background: {type: "solid", color: "#99CCFF"},
      child: {type: "column", children: []}
    }]
  }
}

const model = {
  top: {
    text: Value.constant("Top") // TODO: if model contains raw value, wrap in Value.constant?
  },
  middle: {
    text: Mutable.local("Time")
  }
}

export function uiDemo (renderer :Renderer) :Subject<RenderFn> {
  return Subject.derive(disp => {
    const ui = new UI(theme, model)
    const root = new Root(ui, {...config, scale: renderer.scale} as RootConfig)
    const canvas = root.pack(400, 400)
    const texcfg = {...Texture.DefaultConfig, scale: renderer.scale}
    const gltex = createTexture(renderer.glc, texcfg)
    let tex = imageToTexture(renderer.glc, canvas, texcfg, gltex)

    const uptime = () => model.middle.text.update(new Date().toLocaleTimeString())
    uptime()
    const timer = setInterval(uptime, 1000)

    const pos = vec2.fromValues(10, 10)
    disp((clock, batch, surf) => {
      // TODO: this needs to be more automatic; maybe pass a Stream<Clock> to Root?
      if (root.validate()) {
        root.render(root.ctx)
        tex = imageToTexture(renderer.glc, root.canvas, texcfg, gltex)
      }
      surf.begin()
      surf.clearTo(1, 1, 1, 1)
      surf.draw(tex, pos, tex.size)
      surf.end()
    })

    return () => {
      root.dispose()
      renderer.glc.deleteTexture(gltex)
      clearInterval(timer)
    }
  })
}
