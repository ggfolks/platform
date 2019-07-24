import {Value} from "../core/react"
import {StyleDefs} from "./style"
import {UI, Theme} from "./ui"

const styles :StyleDefs = {
  colors: {},
  shadows: {},
  fonts: {
    base: {family: "Helvetica", size: 16},
    bold: {family: "Helvetica", size: 16, weight: "bold"},
    italic: {family: "Helvetica", size: 16, style: "italic"},
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
  borders: {},
  backgrounds: {}
}

const theme :Theme = {
  default: {
    label: {
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
  },
  button: {
    label: {
      pressed: {font: "$bold"}
    },
  }
}

const noopResolver = {
  resolveImage: (path :string) => Value.constant(new Error("unsupported"))
}

test("style resolution", () => {
  const ui = new UI(styles, theme, {}, noopResolver)

  const lstyles = {stroke: "$lightGray", disabled: {font: "$italic"}}
  const scope = {id: "button", states: ["normal", "disabled", "pressed"]}
  const rstyles :any = ui.resolveStyles(scope, "label", lstyles)
  // comes from label styles in default context
  expect(rstyles.normal.font).toEqual("$base")
  // comes from our "immediate" element styles
  expect(rstyles.disabled.font).toEqual("$italic")
  // comes from label styles in button context
  expect(rstyles.pressed.font).toEqual("$bold")
})
