import {AnimationController, AnimationControllerConfig} from "../animation"
import {TypeScriptComponent, registerConfigurableType} from "./game"

class TypeScriptAnimationController extends TypeScriptComponent implements AnimationController {
  animationControllerConfig :AnimationControllerConfig = {states: {default: {}}}
  readonly state = ""
}
registerConfigurableType(
  "component",
  ["animation"],
  "animationController",
  TypeScriptAnimationController,
)
