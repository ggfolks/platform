import {vec2} from "tfw/core/math"
import {Disposer} from "tfw/core/util"
import {Emitter, Subject, Mutable, Value} from "tfw/core/react"
import {loadImage} from "tfw/core/assets"
import {Renderer} from "tfw/scene2/gl"
import {StyleDefs} from "tfw/ui/style"
import {UI} from "tfw/ui/ui"
import {Host2} from "tfw/ui/host2"
import {RenderFn} from "./index"

const buttonCorner = 3

const styles :StyleDefs = {
  colors: {},
  shadows: {},
  fonts: {
    base: {family: "Helvetica", size: 16},
  },
  paints: {
    white: {type: "color", color: "#FFFFFF"},
    lightGray: {type: "color", color: "#999999"},
    darkGray: {type: "color", color: "#666666"},
    black: {type: "color", color: "#000000"},
    gradient: {
      type: "linear", start: [0, 0], end: [0, 100],
      stops: [[0, "#99FFCC"], [0.5, "#CC99FF"], [1, "#99CCFF"]]
    },
    flappy: {type: "pattern", image: "flappy.png"},
  },
  borders: {
    button: {
      stroke: {type: "color", color: "#000000"},
      cornerRadius: buttonCorner,
    }
  },
  backgrounds: {
    buttonNormal: {
      fill: {type: "color", color: "#99CCFF"},
      cornerRadius: buttonCorner,
      shadow: {offsetX: 2, offsetY: 2, blur: 5, color: "#000000"}
    },
    buttonPressed: {fill: {type: "color", color: "#77AADD"}, cornerRadius: buttonCorner},
    buttonDisabled: {fill: {type: "color", color: "#CC9966"}, cornerRadius: buttonCorner},
  }
}

const theme = {
  default: {
    label: {
      font: "$base",
      fill: "$black",
      disabled: {
        fill: "$darkGray",
      }
    },
  },
  control: {},
  button: {
    box: {
      padding: 10,
      border: "$button",
      background: "$buttonNormal",
      disabled: {background: "$buttonDisabled"},
      pressed: {background: "$buttonPressed"},
    },
  },
}

const config = {
  contents: {
    type: "column",
    offPolicy: "stretch",
    gap: 10,
    contents: [{
      type: "control",
      enabled: "top.enabled",
      constraints: {stretch: true},
      contents: {
        type: "box",
        contents: {
          type: "label",
          text: "top.text",
          style: {
            font: {size: 32, weight: "bold"},
            normal: {
              shadow: {offsetX: 4, offsetY: 4, blur: 5, color: "#666666"}
            }
          }
        },
        style: {
          normal: {background: {fill: {type: "color", color: "#FFCC99"}, cornerRadius: 10}},
          disabled: {background: {fill: {type: "color", color: "#CCFF99"}, cornerRadius: 10}}
        }
      },
    }, {
      type: "box",
      constraints: {stretch: true},
      contents: {type: "label", text: "middle.text", style: {font: {size: 24}}},
      style: {background: {fill: "$gradient"}}
    }, {
      type: "box",
      constraints: {stretch: true},
      contents: {
        type: "button",
        target: "button.target",
        event: "toggle",
        contents: {
          type: "box",
          contents: {type: "label", text: "button.text"},
        },
      },
      style: {background: {fill: "$flappy", cornerRadius: 10}}
    }],
  },
}

const model = {
  top: {
    text: Value.constant("Top"), // TODO: if model contains raw value, wrap in Value.constant?
    enabled: Mutable.local(true)
  },
  middle: {
    text: Mutable.local("Time")
  },
  button: {
    text: Value.constant("Toggle"),
    target: new Emitter<string>()
  }
}

export function uiDemo (renderer :Renderer) :Subject<RenderFn> {
  return Subject.derive(disp => {
    const cleanup = new Disposer()
    const ui = new UI(styles, theme, model, {resolveImage: loadImage})
    const host = new Host2(renderer)
    cleanup.add(host)
    // TODO: this will go away if Host2 does it automatically
    cleanup.add(host.bind(renderer.canvas))

    const rootOrigin = vec2.fromValues(10, 10)
    const root = ui.createRoot({type: "root", scale: renderer.scale, ...config})
    root.pack(400, 400)
    host.addRoot(root, rootOrigin)

    cleanup.add(model.button.target.onEmit(event => {
      if (event === "toggle") model.top.enabled.update(!model.top.enabled.current)
    }))

    const uptime = () => model.middle.text.update(new Date().toLocaleTimeString())
    uptime()
    const timer = setInterval(uptime, 1000)
    cleanup.add(() => clearInterval(timer))

    disp((clock, batch, surf) => {
      host.update(clock)
      surf.begin()
      surf.clearTo(1, 1, 1, 1)
      host.render(surf)
      surf.end()
    })

    return () => cleanup.dispose()
  })
}
