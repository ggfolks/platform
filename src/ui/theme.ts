const textCorner = 2
const checkBoxCorner = 2
const tabCorner = [5, 5, 0, 0]
const nodeHeaderCorner = [5, 5, 0, 0]
const nodeBodyCorner = [0, 0, 5, 5]
const menuCorner = [5, 5, 0, 0]
const dropdownCorner = 5
const nodeButtonCorner = 5

const family = "Helvetica, sans-serif"

/** A default set of styles to use as a base. */
export const DefaultStyles = {
  colors: {},
  shadows: {},
  fonts: {
    base: {family, size: 24},
    menu: {family, size: 16},
    tab: {family, size: 16},
    nodeTitle: {family, size: 16},
    nodeButton: {family, size: 14},
    nodeProperty: {family, size: 14},
    dropdown: {family, size: 14},
    text: {family, size: 14},
    edgeName: {family, size: 14},
  },
  paints: {
    white: {type: "color", color: "#FFFFFF"},
    lighterGray: {type: "color", color: "#E0E0E0"},
    lightGray: {type: "color", color: "#D0D0D0"},
    mediumGray: {type: "color", color: "#808080"},
    black: {type: "color", color: "#000000"},
  },
  borders: {
    textNormal: {stroke: {type: "color", color: "#808080"}, cornerRadius: textCorner},
    textDisabled: {stroke: {type: "color", color: "#606060"}, cornerRadius: textCorner},
    textFocused: {stroke: {type: "color", color: "#D0D0D0"}, cornerRadius: textCorner},
    textInvalid: {stroke: {type: "color", color: "#FF0000"}, cornerRadius: textCorner},
    checkBox: {stroke: {type: "color", color: "#999999"}, cornerRadius: checkBoxCorner},
    tabHovered: {
      stroke: {type: "color", color: "#303030"},
      width: [1, 1, 0, 1],
      cornerRadius: tabCorner,
    },
    tabList: {stroke: {type: "color", color: "#303030"}, width: [0, 0, 1, 0]},
    graphViewSelect: {stroke: {type: "color", color: "#808080"}},
    nodeHeader: {stroke: {type: "color", color: "#000000"}, cornerRadius: nodeHeaderCorner},
    nodeHeaderHovered: {stroke: {type: "color", color: "#303030"}, cornerRadius: nodeHeaderCorner},
    nodeHeaderSelected: {stroke: {type: "color", color: "#808080"}, cornerRadius: nodeHeaderCorner},
    nodeBody: {stroke: {type: "color", color: "#000000"}, cornerRadius: nodeBodyCorner},
    nodeBodyHovered: {stroke: {type: "color", color: "#303030"}, cornerRadius: nodeBodyCorner},
    nodeBodySelected: {stroke: {type: "color", color: "#808080"}, cornerRadius: nodeBodyCorner},
  },
  backgrounds: {
    root: {fill: {type: "color", color: "rgba(48, 48, 48, 0.5)"}},
    text: {fill: {type: "color", color: "#FFFFFF"}, cornerRadius: textCorner},
    dropdown: {fill: {type: "color", color: "#303030"}, cornerRadius: dropdownCorner},
    dropdownHovered: {fill: {type: "color", color: "#282828"}, cornerRadius: dropdownCorner},
    dropdownPressed: {fill: {type: "color", color: "#202020"}, cornerRadius: dropdownCorner},
    dropdownitem: {fill: {type: "color", color: "#303030"}},
    dropdownitemHovered: {fill: {type: "color", color: "#282828"}},
    dropdownitemPressed: {fill: {type: "color", color: "#202020"}},
    tabSelected: {fill: {type: "color", color: "#303030"}, cornerRadius: tabCorner},
    menu: {fill: {type: "color", color: "#303030"}, cornerRadius: menuCorner},
    menuHovered: {fill: {type: "color", color: "#282828"}, cornerRadius: menuCorner},
    menuPressed: {fill: {type: "color", color: "#202020"}, cornerRadius: menuCorner},
    menuitem: {fill: {type: "color", color: "#303030"}},
    menuitemHovered: {fill: {type: "color", color: "#282828"}},
    menuitemPressed: {fill: {type: "color", color: "#202020"}},
    graphViewerHeader: {fill: {type: "color", color: "#303030"}, cornerRadius: [5, 5, 0, 0]},
    graphViewSelect: {fill: {type: "color", color: "rgba(64, 64, 64, 0.25)"}},
    nodeHeader: {fill: {type: "color", color: "#404040"}, cornerRadius: nodeHeaderCorner},
    nodeBody: {fill: {type: "color", color: "#606060"}, cornerRadius: nodeBodyCorner},
    nodeButton: {fill: {type: "color", color: "#404040"}, cornerRadius: nodeButtonCorner},
    nodeButtonHovered: {fill: {type: "color", color: "#383838"}, cornerRadius: nodeButtonCorner},
    nodeButtonPressed: {fill: {type: "color", color: "#303030"}, cornerRadius: nodeButtonCorner},
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
    dropdown: {},
    dropdownitem: {},
    menu: {
      hovered: {},
      hoverFocused: {},
    },
    menuitem: {},
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
  checkBox: {
    box: {border: "$checkBox", padding: [3, 8, 0, 7]},
    label: {font: "$nodeProperty"},
  },
  checkBoxChecked: {
    box: {border: "$checkBox", padding: [3, 5, 0, 5]},
    label: {font: "$nodeProperty"},
  },
  tab: {
    box: {
      padding: 10,
      margin: [5, 0, 0, 0],
      hovered: {border: "$tabHovered"},
      selected: {border: "$tabHovered", background: "$tabSelected"},
    },
    label: {font: "$tab"},
  },
  tabList: {
    box: {padding: [0, 5, 0, 5], border: "$tabList"}
  },
  text: {
    box: {
      padding: 2,
      border: "$textNormal",
      background: "$text",
      hovered: {cursor: "text"},
      disabled: {border: "$textDisabled"},
      focused: {border: "$textFocused", cursor: "text"},
      hoverFocused: {border: "$textFocused", cursor: "text"},
      invalid: {border: "$textInvalid", cursor: "text"},
    },
    label: {font: "$text", fill: "$black"},
    cursor: {stroke: "$black"},
  },
  editablelabel: {
    box: {
      focused: {cursor: "text"},
      hoverFocused: {cursor: "text"},
    },
    label: {font: "$text"},
    cursor: {stroke: "$white"},
  },
  dropdown: {
    box: {
      padding: [3, 8, 3, 8],
      background: "$dropdown",
      hovered: {background: "$dropdownHovered"},
      hoverFocused: {background: "$dropdownHovered"},
      pressed: {background: "$dropdownPressed"},
    },
    label: {font: "$dropdown"},
  },
  dropdownitem: {
    box: {
      padding: [3, 8, 3, 8],
      background: "$dropdownitem",
      hovered: {background: "$dropdownitemHovered"},
      hoverFocused: {background: "$dropdownitemHovered"},
      pressed: {background: "$dropdownitemPressed"},
      separator: {background: null},
    },
    label: {font: "$dropdown"},
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
