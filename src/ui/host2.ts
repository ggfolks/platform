import {vec2} from "../core/math"
import {Root, Host} from "./element"
import {Renderer, Texture, createTexture, imageToTexture} from "../scene2/gl"
import {Surface} from "../scene2/surface"

export class Host2 extends Host {
  textures :Texture[] = []

  constructor (readonly renderer :Renderer) {
    super()
    // TODO: should we auto-bind to canvas and unbind in dispose?
  }

  render (surf :Surface) {
    for (let ii = 0, ll = this.roots.length; ii < ll; ii += 1) {
      const ro = this.roots[ii], origin = ro[1]
      const tex = this.textures[ii]
      surf.draw(tex, origin, tex.size)
    }
  }

  dispose () {
    super.dispose()
    for (const tex of this.textures) this.renderer.glc.deleteTexture(tex.tex)
  }

  protected rootAdded (root :Root, origin :vec2, index :number) {
    const {glc, scale} = this.renderer
    const texcfg = {...Texture.DefaultConfig, scale: scale}
    const gltex = createTexture(glc, texcfg)
    this.textures[index] = imageToTexture(glc, root.canvas, texcfg, gltex)
    console.log(`Root added ${this.textures[index]}`)
  }

  protected rootUpdated (root :Root, origin :vec2, index :number) {
    const otex = this.textures[index]
    this.textures[index] = imageToTexture(this.renderer.glc, root.canvas, otex.config, otex.tex)
  }
}
