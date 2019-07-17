import {Value} from "../core/react"
import {ElementConfig} from "./element"
import {UI} from "./ui"

const theme = {
  styles: {
    baseFont: {family: "Helvetica", size: 16},
    boldFont: {family: "Helvetica", size: 16, weight: "bold"},

    whitePaint: {type: "color", color: "#FFFFFF"},
    lightGrayPaint: {type: "color", color: "#999999"},
    darkGrayPaint: {type: "color", color: "#333333"},
    blackPaint: {type: "color", color: "#000000"},

    gradientPaint: {
      type: "linear", start: [0, 0], end: [0, 100],
      stops: [[0, "#99FFCC"], [0.5, "#CC99FF"], [1, "#99CCFF"]]
    },
    flappyPatternPaint: {type: "pattern", image: "flappy.png"},
  },

  elements: {
    base: {
      font: "$baseFont",
      normal: {
        stroke: "$whitePaint",
        fill: "$blackPaint",
      },
      disabled: {
        stroke: "$lightGrayPaint",
        fill: "$darkGrayPaint",
      }
    },
    label: {
      parent: "base"
    },
    button: {
      parent: "base",
      padding: 5,
      normal: {
        background: {fill: {type: "color", color: "#FFCC99"}}
      },
      disabled: {
        background: {fill: {type: "color", color: "#CC9966"}}
      },
    }
  }
}

const noopResolver = {
  resolveImage: (path :string) => Value.constant(new Error("unsupported"))
}

test("config resolution", () => {
  const ui = new UI(theme, {}, noopResolver)

  const bconfig :ElementConfig = {type: "button", style: {
    stroke: "$lightGrayPaint",
    pressed: {font: "$boldFont"}
  }} as any
  const config :any = ui.resolveConfig(bconfig, ["disabled", "pressed"])
  // console.dir(config)

  expect(config.style.normal.font.size).toEqual(16)
  expect(config.style.disabled.font.size).toEqual(16)
  expect(config.style.pressed.font.size).toEqual(16)

  expect(config.style.normal.background.fill.color).toEqual("#FFCC99")
  expect(config.style.disabled.background.fill.color).toEqual("#CC9966")
})
