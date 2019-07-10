import {dim2, vec2, vec2zero} from "tfw/core/math"
import {Value} from "tfw/core/react"
import {Clock} from "tfw/core/clock"
import {loadImage} from "tfw/core/assets"
import {Renderer, Scale, Tile, Texture, makeTexture} from "tfw/scene2/gl"
import {QuadBatch} from "tfw/scene2/batch"
import {Surface} from "tfw/scene2/surface"
import {DenseValueComponent, Domain, Float32Component, Matcher, System, Vec2Component}
from "tfw/entity/entity"
import {TransformComponent, RenderSystem, DynamicsSystem} from "tfw/scene2/entity"

class BounceSystem extends System {

  constructor (domain :Domain,
               readonly size :Value<dim2>,
               readonly trans :TransformComponent,
               readonly vel :Vec2Component,
               readonly rotvel :Float32Component) {
    super(domain, Matcher.hasAllC(trans.id, vel.id, rotvel.id))
  }

  update () {
    const tmpv = vec2.create(), tmpm = vec2.create()
    const sz = this.size.current, sw = sz[0], sh = sz[1]
    this.onEntities(id => {
      this.trans.readTranslation(id, tmpv)
      vec2.set(tmpm, 1, 1)
      const tx = tmpv[0], ty = tmpv[1]
      let bounce = false
      if (tx < 0 || tx > sw) { bounce = true ; tmpm[0] = -1 }
      if (ty < 0 || ty > sh) { bounce = true ; tmpm[1] = -1 }
      if (bounce) {
        this.vel.read(id, tmpv)
        this.vel.update(id, vec2.mul(tmpm, tmpv, tmpm))
        this.rotvel.update(id, this.rotvel.read(id)*-1)
      }
    })
  }
}

class RotateSystem extends System {
  constructor (domain :Domain,
               readonly trans :TransformComponent,
               readonly rotvel :Float32Component) {
    super(domain, Matcher.hasAllC(trans.id, rotvel.id))
  }

  update (clock :Clock) {
    this.onEntities(id => {
      const rotvel = this.rotvel.read(id)
      const rot = this.trans.readRotation(id)
      this.trans.updateRotation(id, rot+rotvel*clock.dt)
    })
  }
}

export function entityDemo (renderer :Renderer) {
  const {glc} = renderer
  const birdS = loadImage("flappy.png")
  const texS = Value.constant({...Texture.DefaultConfig, scale: new Scale(2)})
  const birdT = makeTexture(glc, birdS, texS)

  return birdT.map(bird => {
    const batchBits = 12 // 4096 entities per batch
    const trans = new TransformComponent("trans", batchBits)
    const rotvel = new Float32Component("rotvel", 0, batchBits)
    const tile = new DenseValueComponent<Tile>("tile", bird)
    const vel = new Vec2Component("vel", vec2zero, batchBits)

    const domain = new Domain({}, {trans, rotvel, tile, vel})
    const rotsys = new RotateSystem(domain, trans, rotvel)
    const dynamsys = new DynamicsSystem(domain, trans, vel)
    const ssize = renderer.size.map(s => dim2.scale(dim2.create(), s, 2))
    const bouncesys = new BounceSystem(domain, ssize, trans, vel, rotvel)
    // TODO: should we have the render system handle HiDPI scale?
    const rendersys = new RenderSystem(domain, trans, tile)

    const econfig = {
      components: {trans: {}, tile: {}, vel: {}, rotvel: {}}
    }

    const initVel = vec2.create()
    for (let ii = 0; ii < 10000; ii += 1) {
      const id = domain.add(econfig)
      trans.updateOrigin(id, bird.size[0]/2, bird.size[1]/2)
      rotvel.update(id, Math.random()*Math.PI*2)
      trans.updateTranslation(id, Math.random()*ssize.current[0], Math.random()*ssize.current[1])
      vel.update(id, vec2.set(initVel, (Math.random()-0.5)*300, (Math.random()-0.5)*300))
    }

    return (clock :Clock, batch :QuadBatch, surf :Surface) => {
      rotsys.update(clock)
      dynamsys.update(clock)
      bouncesys.update()
      rendersys.update()
      surf.begin()
      surf.clearTo(1, 0, 1, 1)
      rendersys.render(batch)
      surf.end()
    }
  })
}
