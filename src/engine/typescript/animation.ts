import {Mutable, Value} from "../../core/react"
import {AnimationController, AnimationControllerConfig} from "../animation"
import {TypeScriptComponent, registerComponentType} from "./game"

class TypeScriptAnimationController extends TypeScriptComponent implements AnimationController {
  private _config :AnimationControllerConfig = {states: {default: {}}}
  private readonly _state = Mutable.local("default")

  get config () :AnimationControllerConfig { return this._config }
  set config (config :AnimationControllerConfig) { this._config = config }

  get state () :Value<string> { return this._state }
}
registerComponentType(["animation"], "animationController", TypeScriptAnimationController)
