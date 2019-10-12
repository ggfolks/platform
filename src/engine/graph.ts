import {Component} from "./game"
import {GraphConfig} from "../graph/graph"

/** Manages the object's behavior graph. */
export interface Graph extends Component {

  /** The graph configuration. */
  config :GraphConfig
}
