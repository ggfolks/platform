
/** A default set of styles to use as a base. */
export const DefaultStyles = {
  colors: {},
  shadows: {},
  fonts: {
    base: {family: "Helvetica, sans-serif", size: 24},
    menu: {family: "Helvetica, sans-serif", size: 16},
    nodeTitle: {family: "Helvetica, sans-serif", size: 16},
    nodeButton: {family: "Helvetica, sans-serif", size: 14},
    nodeProperty: {family: "Helvetica, sans-serif", size: 14},
    edgeName: {family: "Helvetica, sans-serif", size: 14},
  },
  paints: {
    white: {type: "color", color: "#FFFFFF"},
    lighterGray: {type: "color", color: "#E0E0E0"},
    lightGray: {type: "color", color: "#D0D0D0"},
    mediumGray: {type: "color", color: "#808080"},
    black: {type: "color", color: "#000000"},
  },
  borders: {
    graphViewSelect: {
      stroke: {type: "color", color: "#808080"},
    },
    nodeHeader: {
      stroke: {type: "color", color: "#000000"},
      cornerRadius: [5, 5, 0, 0],
    },
    nodeHeaderHovered: {
      stroke: {type: "color", color: "#303030"},
      cornerRadius: [5, 5, 0, 0],
    },
    nodeHeaderSelected: {
      stroke: {type: "color", color: "#808080"},
      cornerRadius: [5, 5, 0, 0],
    },
    nodeBody: {
      stroke: {type: "color", color: "#000000"},
      cornerRadius: [0, 0, 5, 5],
    },
    nodeBodyHovered: {
      stroke: {type: "color", color: "#303030"},
      cornerRadius: [0, 0, 5, 5],
    },
    nodeBodySelected: {
      stroke: {type: "color", color: "#808080"},
      cornerRadius: [0, 0, 5, 5],
    },
  },
  backgrounds: {
    root: {
      fill: {type: "color", color: "rgba(48, 48, 48, 0.5)"},
    },
    menu: {
      fill: {type: "color", color: "#303030"},
      cornerRadius: [5, 5, 0, 0],
    },
    menuHovered: {
      fill: {type: "color", color: "#282828"},
      cornerRadius: [5, 5, 0, 0],
    },
    menuPressed: {
      fill: {type: "color", color: "#202020"},
      cornerRadius: [5, 5, 0, 0],
    },
    menuitem: {
      fill: {type: "color", color: "#303030"},
    },
    menuitemHovered: {
      fill: {type: "color", color: "#282828"},
    },
    menuitemPressed: {
      fill: {type: "color", color: "#202020"},
    },
    menuitemSeparator: {
      fill: {type: "color", color: "#202020"},
    },
    graphViewerHeader: {
      fill: {type: "color", color: "#303030"},
      cornerRadius: [5, 5, 0, 0],
    },
    graphViewSelect: {
      fill: {type: "color", color: "rgba(64, 64, 64, 0.25)"},
    },
    nodeHeader: {
      fill: {type: "color", color: "#404040"},
      cornerRadius: [5, 5, 0, 0],
    },
    nodeBody: {
      fill: {type: "color", color: "#606060"},
      cornerRadius: [0, 0, 5, 5],
    },
    nodeButton: {
      fill: {type: "color", color: "#404040"},
      cornerRadius: 5,
    },
    nodeButtonHovered: {
      fill: {type: "color", color: "#383838"},
      cornerRadius: 5,
    },
    nodeButtonPressed: {
      fill: {type: "color", color: "#303030"},
      cornerRadius: 5,
    },
  },
}

/** A default theme to use as a base. */
export const DefaultTheme = {
  default: {
    label: {
      font: "$base",
      fill: "$white",
      selection: {fill: "$lightGray"},
      disabled: {fill: "$mediumGray"},
    },
    box: {
      hovered: {cursor: "pointer"},
      hoverFocused: {cursor: "pointer"},
      pressed: {cursor: "pointer"},
    },
    menu: {
      hovered: {},
      hoverFocused: {},
      minWidth: 150,
    },
    menuitem: {minWidth: 150},
    shortcut: {font: "$menu", fill: "$mediumGray"},
    graphview: {
      selectBackground: "$graphViewSelect",
      selectBorder: "$graphViewSelect",
    },
    edgeview: {
      lineWidth: 3,
      hovered: {outlineWidth: 5, outlineAlpha: 0.5, cursor: "pointer"},
    },
    terminal: {
      edge: {lineWidth: 3, outlineWidth: 5, outlineAlpha: 0.5},
      hovered: {outlineWidth: 2, outlineAlpha: 0.5, cursor: "pointer"},
      targeted: {outlineWidth: 2, outlineAlpha: 0.5},
    },
  },
  control: {},
  button: {
    box: {padding: 5},
    label: {
      hovered: {fill: "$lighterGray"},
      hoverFocused: {fill: "$lighterGray"},
      pressed: {fill: "$lightGray"},
    },
  },
  menu: {
    box: {
      padding: [5, 10, 5, 10],
      background: "$menu",
      hovered: {background: "$menuHovered"},
      hoverFocused: {background: "$menuHovered"},
      pressed: {background: "$menuPressed"},
    },
    label: {font: "$menu"},
  },
  menuitem: {
    box: {
      padding: [5, 5, 5, 15],
      background: "$menuitem",
      hovered: {background: "$menuitemHovered"},
      hoverFocused: {background: "$menuitemHovered"},
      pressed: {background: "$menuitemPressed"},
      separator: {background: null},
    },
    label: {font: "$menu"},
  },
  graphViewerHeader: {
    box: {background: "$graphViewerHeader"},
  },
  node: {
    box: {padding: 10},
  },
  nodeHeader: {
    label: {font: "$nodeTitle"},
    box: {
      padding: 5,
      background: "$nodeHeader",
      border: "$nodeHeader",
      hovered: {border: "$nodeHeaderHovered"},
      selected: {border: "$nodeHeaderSelected"},
    },
  },
  nodeBody: {
    box: {
      padding: 5,
      background: "$nodeBody",
      border: "$nodeBody",
      hovered: {border: "$nodeBodyHovered"},
      selected: {border: "$nodeBodySelected"},
    },
  },
  nodeButton: {
    box: {
      padding: 5,
      background: "$nodeButton",
      hovered: {background: "$nodeButtonHovered"},
      hoverFocused: {background: "$nodeButtonHovered"},
      pressed: {background: "$nodeButtonPressed"},
    },
    label: {font: "$nodeButton"},
  },
  nodeProperties: {
    label: {font: "$nodeProperty", fill: "$lightGray"},
  },
  nodeEdges: {
    box: {padding: 0, background: null},
  },
  nodeInput: {
    box: {padding: [0, 0, 0, 5]},
    label: {font: "$edgeName"},
  },
  nodeOutput: {
    box: {padding: [0, 5, 0, 0]},
    label: {font: "$edgeName"},
  },
  terminal: {},
}
