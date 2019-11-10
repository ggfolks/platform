import {Value} from "../../core/react"
import {MutableMap, RMap} from "../../core/rcollect"
import {PMap, getValue} from "../../core/util"
import {Animation, AnimationController, AnimationControllerConfig} from "../animation"
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
              const condition = stateConfig.transitions[transition].condition
              if (condition) result.set(stripNegationPrefix(condition), ConditionMeta)
            }
          }
        }
        return result
      },
    )
  }

  init () {
    super.init()
    this._disposer.add(
      Value
        .join3(
          this.getProperty<AnimationControllerConfig>("animationControllerConfig"),
          this.getProperty<string>("state"),
          this.gameObject.getProperty<Animation>("animation"),
        )
        .switchMap(([config, state, animation]) => {
          const conditionValues :Value<boolean>[] = []
          const stateConfig = config.states[state]
          if (stateConfig) {
            if (stateConfig.url && animation) {
              animation.wrapMode = stateConfig.finishBeforeTransition
                ? "once"
                : stateConfig.clampWhenFinished
                ? "clampForever"
                : "loop"
              animation.timeScale = getValue(stateConfig.timeScale, 1)
              animation.repetitions = getValue(stateConfig.repetitions, Infinity)
              animation.playing = stateConfig.url
            }
            if (stateConfig.transitions) {
              for (const transition in stateConfig.transitions) {
                const condition = stateConfig.transitions[transition].condition
                if (condition) {
                  const conditionName = stripNegationPrefix(condition)
                  this._maybeCreatePropertyValue(conditionName, ConditionMeta)
                  conditionValues.push(this.getProperty(conditionName))
                }
              }
            }
          }
          return Value.join(
            ...conditionValues,
            animation ? animation.getProperty("playing").map(Boolean) : Value.constant(true),
          )
        })
        .onValue(conditions => {
          const stateConfig = this.animationControllerConfig.states[this.state]
          if (!stateConfig) return
          let stateWeights :PMap<number> = {}
          let stateWeightPriority = -Infinity
          let totalWeight = 0
          if (stateConfig.transitions) {
            for (const transition in stateConfig.transitions) {
              const transitionConfig = stateConfig.transitions[transition]
              const condition = transitionConfig.condition
              if (
                !condition ||
                (condition.startsWith("!") ? !this[condition.substring(1)] : this[condition])
              ) {
                const priority = getValue(transitionConfig.priority, 0)
                if (priority > stateWeightPriority) {
                  stateWeights = {}
                  stateWeightPriority = priority
                  totalWeight = 0
                }
                if (stateWeights[transition] === undefined) stateWeights[transition] = 0
                const weight = getValue(transitionConfig.weight, 1)
                stateWeights[transition] += weight
                totalWeight += weight
              }
            }
          }
          if (
            stateConfig.finishBeforeTransition &&
            conditions[conditions.length - 1] &&
            stateWeightPriority <= getValue(stateConfig.interruptPriority, 0)
          ) return
          if (totalWeight === 0) return
          let targetWeight = Math.random() * totalWeight
          for (const state in stateWeights) {
            if ((targetWeight -= stateWeights[state]) <= 0) {
              this.state = state
              break
            }
          }
        })
    )
  }
}
registerConfigurableType(
  "component",
  ["animation"],
  "animationController",
  TypeScriptAnimationController,
)

function stripNegationPrefix (condition :string) :string {
  return condition.startsWith("!") ? condition.substring(1) : condition
}
