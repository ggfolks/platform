import {Root, Host} from "./element"
import {Renderer, Texture, createTexture, imageToTexture} from "../scene2/gl"
import {Surface} from "../scene2/surface"

export class Host2 extends Host {
  textures :Texture[] = []

  constructor (readonly renderer :Renderer) {
    super()
    this.roots.onChange(ev => {
      if (ev.type === "added") this.rootAdded(ev.elem, ev.index)
    })
  }

  render (surf :Surface) {
    for (let ii = 0, ll = this.roots.length; ii < ll; ii += 1) {
      const root = this.roots.elemAt(ii), tex = this.textures[ii]
      if (root.visible.current) surf.draw(tex, root.origin, tex.size)
    }
  }

  dispose () {
    super.dispose()
    for (const tex of this.textures) this.renderer.glc.deleteTexture(tex.tex)
  }

  private rootAdded (root :Root, index :number) {
    const {glc, scale} = this.renderer, textures = this.textures
    const texcfg = {...Texture.DefaultConfig, scale: scale}
    const gltex = createTexture(glc, texcfg)
    textures[index] = imageToTexture(glc, root.canvasElem, texcfg, gltex)

    const unroot = root.events.onEmit(e => {
      if (e === "rendered") {
        const otex = textures[index]
        textures[index] = imageToTexture(glc, root.canvasElem, otex.config, otex.tex)
      } else if (e === "removed") {
        glc.deleteTexture(textures[index].tex)
        delete textures[index]
        unroot()
      }
    })
  }
}
