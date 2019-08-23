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
      const root = this.roots[ii]
      const tex = this.textures[ii]
      surf.draw(tex, root.origin, tex.size)
    }
  }

  dispose () {
    super.dispose()
    for (const tex of this.textures) this.renderer.glc.deleteTexture(tex.tex)
  }

  protected rootAdded (root :Root, index :number) {
    const {glc, scale} = this.renderer
    const texcfg = {...Texture.DefaultConfig, scale: scale}
    const gltex = createTexture(glc, texcfg)
    this.textures[index] = imageToTexture(glc, root.canvasElem, texcfg, gltex)
    console.log(`Root added ${this.textures[index]}`)
  }

  protected rootUpdated (root :Root, index :number) {
    const otex = this.textures[index]
    this.textures[index] = imageToTexture(this.renderer.glc, root.canvasElem, otex.config, otex.tex)
  }
}
