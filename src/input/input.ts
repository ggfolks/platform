import {vec2} from "gl-matrix"

/** Describes a touch (or mouse) point. */
export class Touch {
  
  constructor (readonly position :vec2 = vec2.create(), readonly pressed :boolean = false) {}
}
