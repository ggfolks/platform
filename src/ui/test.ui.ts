import {Value} from "../core/react"
import {ElementConfig} from "./element"
import {StyleDefs} from "./style"
import {UI} from "./ui"

const styles :StyleDefs = {
  colors: {},
  shadows: {},
  fonts: {
    base: {family: "Helvetica", size: 16},
    bold: {family: "Helvetica", size: 16, weight: "bold"},
  },
  paints: {
    white: {type: "color", color: "#FFFFFF"},
    lightGray: {type: "color", color: "#999999"},
    darkGray: {type: "color", color: "#333333"},
    black: {type: "color", color: "#000000"},
    gradient: {
      type: "linear", start: [0, 0], end: [0, 100],
      stops: [[0, "#99FFCC"], [0.5, "#CC99FF"], [1, "#99CCFF"]]
    },
    flappy: {type: "pattern", image: "flappy.png"},
  },
}

const elements = {
  base: {
    font: "$base",
    normal: {
      stroke: "$white",
      fill: "$black",
    },
    disabled: {
      stroke: "$lightGray",
      fill: "$darkGray",
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

const noopResolver = {
  resolveImage: (path :string) => Value.constant(new Error("unsupported"))
}

test("config resolution", () => {
  const ui = new UI(styles, elements, {}, noopResolver)

  const bconfig :ElementConfig = {type: "button", style: {
    stroke: "$lightGray",
    pressed: {font: "$bold"}
  }} as any
  const config :any = ui.resolveConfig(bconfig, ["disabled", "pressed"])
  // console.dir(config)

  expect(config.style.normal.font).toEqual("$base")
  expect(config.style.disabled.font).toEqual("$base")
  expect(config.style.pressed.font).toEqual("$bold")

  expect(config.style.normal.background.fill.color).toEqual("#FFCC99")
  expect(config.style.disabled.background.fill.color).toEqual("#CC9966")
})
