import {
  AnimationClip, BoxBufferGeometry, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  Object3D, RGBAFormat,
} from "three"
import {GLTFLoader} from "three/examples/jsm/loaders/GLTFLoader"

import {Subject} from "../core/react"
import {log} from "../core/util"
import {ResourceLoader} from "./loader"

const errorAnimation = new AnimationClip("error", 0, [])

/**
 * Loads a GLTF animation clip identified by an anchored URL, where the anchor tag is taken to
 * represent the clip name.
 */
export function loadGLTFAnimationClip (
  loader :ResourceLoader, path :string
) :Subject<AnimationClip> {
  const idx = path.indexOf("#")
  return loadGLTF(loader, path.substring(0, idx)).map(gltf => {
    const clip = AnimationClip.findByName(gltf.animations, path.substring(idx + 1))
    if (clip) return clip
    log.warn("Missing requested animation", "path", path)
    return errorAnimation
  })
}

/** The contents of a loaded GLTF. */
export interface GLTF {
  scene :Object3D
  animations :AnimationClip[]
}

const activeGLTFs :Map<string, Subject<GLTF>> = new Map()
const dormantGLTFs :Map<string, Promise<GLTF>> = new Map()
const errorGeom = new BoxBufferGeometry()
const errorMat = new MeshBasicMaterial({color: 0xFF0000})

/** Loads a GLTF from the provided URL.
  * @param url the URL of the GLTF to load.
  * @return a Subject that will resolve to the loaded model. */
export function loadGLTF (loader :ResourceLoader, path :string) :Subject<GLTF> {
  let gltf = activeGLTFs.get(path)
  if (!gltf) {
    let active = false
    gltf = Subject.deriveSubject(dispatch => {
      active = true
      activeGLTFs.set(path, gltf!)
      let savedGLTF = dormantGLTFs.get(path)
      if (savedGLTF) {
        dormantGLTFs.delete(path)
      } else {
        const url = loader.getUrl(path)
        savedGLTF = new Promise(resolve => new GLTFLoader().load(
          url,
          gltf => {
            // hack for alpha testing: enable on any materials with a color texture that has
            // an alpha channel
            gltf.scene.traverse((node :Object3D) => {
              if (node instanceof Mesh) processMaterial(node.material)
            })
            resolve(gltf)
          },
          event => { /* do nothing with progress for now */ },
          error => {
            log.warn("Could not load GLTF", "url", url, "error", error)
            resolve({scene: new Mesh(errorGeom, errorMat), animations: []})
          },
        ))
      }
      savedGLTF.then(gltf => {
        if (active) dispatch(gltf)
      })
      return () => {
        active = false
        activeGLTFs.delete(path)
        dormantGLTFs.set(path, savedGLTF!)
      }
    })
  }
  return gltf
}

function processMaterial (material :Material|Material[]) {
  if (Array.isArray(material)) material.forEach(processMaterial)
  else {
    if (material instanceof MeshStandardMaterial &&
        material.map &&
        material.map.format === RGBAFormat) {
      material.alphaTest = 0.25
      material.transparent = false
    }
    // note that this material may be shared by multiple instances
    material.userData.shared = true
  }
}
