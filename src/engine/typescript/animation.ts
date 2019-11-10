import {Value} from "../../core/react"
import {MutableMap, RMap} from "../../core/rcollect"
import {AnimationController, AnimationControllerConfig} from "../animation"
import {PropertyMeta, property} from "../meta"
import {TypeScriptComponent, registerConfigurableType} from "./game"

const ConditionMeta = {type: "boolean", constraints: {transient: true}}

class TypeScriptAnimationController extends TypeScriptComponent implements AnimationController {
  @property("animationControllerConfig") animationControllerConfig :AnimationControllerConfig = {
    states: {default: {}},
  }
  @property("string") state = "default"

  get propertiesMeta () :RMap<string, PropertyMeta> {
    const configValue = this["animationControllerConfigValue"] as
      Value<AnimationControllerConfig>|undefined
    if (!configValue) return super.propertiesMeta
    return RMap.fromValue(
      configValue,
      config => {
        const result = MutableMap.local<string, PropertyMeta>()
        for (const [property, meta] of super.propertiesMeta) {
          result.set(property, meta)
        }
        for (const state in config.states) {
          const stateConfig = config.states[state]
          if (stateConfig.transitions) {
            for (const transition in stateConfig.transitions) {
              let conditionName = stateConfig.transitions[transition].condition
              if (conditionName) {
                if (conditionName.startsWith("!")) conditionName = conditionName.substring(1)
                if (!result.has(conditionName)) {
                  result.set(conditionName, ConditionMeta)
                  this._maybeCreatePropertyValue(conditionName, ConditionMeta)
                }
              }
            }
          }
        }
        return result
      },
    )
  }
}
registerConfigurableType(
  "component",
  ["animation"],
  "animationController",
  TypeScriptAnimationController,
)
