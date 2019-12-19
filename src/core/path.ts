import {UUID} from "./uuid"

/** Identifies the path to a resource from the root of that resource tree. This is used for the data
  * system, the service system and the space system. In the data system, even path elements are
  * object property names, odd path elements are object collection keys (UUIDs). In the service and
  * space systems, paths are usually a sequence of human readable names, sometimes with a single
  * UUID as the final path component to identify a specific instance of a space or service. */
export type Path = Array<string | UUID>

function checkPath (path :Path) :Path {
  if (path === undefined) throw new Error(`Illegal undefined path`)
  return path
}

class PathNode<T> {
  private value :T|undefined = undefined
  private children :{[key :string] :PathNode<T>}|undefined = undefined

  get (path :Path, pos :number) :T|undefined {
    if (pos === path.length) return this.value
    else if (!this.children) return undefined
    else {
      const childmap = this.children[path[pos]]
      return childmap ? childmap.get(path, pos+1) : undefined
    }
  }

  set (path :Path, pos :number, value :T) :boolean {
    if (pos === path.length) {
      const wasEmpty = this.value === undefined
      this.value = value
      return wasEmpty
    } else {
      const children = this.children || (this.children = {})
      const child = children[path[pos]] || (children[path[pos]] = new PathNode<T>())
      return child.set(path, pos+1, value)
    }
  }

  delete (path :Path, pos :number) :T|undefined {
    if (pos === path.length) {
      const ovalue = this.value
      this.value = undefined
      return ovalue
    }
    else if (!this.children) return undefined
    else {
      const child = this.children[path[pos]]
      return child ? child.delete(path, pos+1) : undefined
    }
  }

  forEach (op :(v:T, p:Path) => void, path :Path) {
    const {value, children} = this
    if (value) op(value, path)
    if (children) for (const key in children) children[key].forEach(op, path.concat(key))
  }
}

/** Maintains a mapping from `Path` objects to arbitrary values (of the same type). */
export class PathMap<T> {
  private root = new PathNode<T>()
  private _size = 0

  /** Looks and returns the mapping for `path`, or `undefined` if no mapping exists. */
  get (path :Path) :T|undefined { return this.root.get(checkPath(path), 0) }

  /** Sets the mapping for `path` to `value`.
    * @return `value` for handy call chaining. */
  set (path :Path, value :T) :T {
    if (this.root.set(checkPath(path), 0, value)) this._size += 1
    return value
  }

  /** Returns the number of mappings in this map. */
  get size () { return this._size }

  /** Looks up and returns the mapping for `path`, throws an error if no mapping exists. */
  require (path :Path) :T {
    const result = this.root.get(checkPath(path), 0)
    if (!result) throw new Error(`Missing value for ${path}`)
    return result
  }

  /** Deletes the mapping for `path`.
    * @return the previous value of the mapping. */
  delete (path :Path) :T|undefined {
    const oval = this.root.delete(checkPath(path), 0)
    if (oval !== undefined) this._size -= 1
    return oval
  }

  /** Removes all mappings from this map. */
  clear () {
    this.root = new PathNode<T>()
    this._size = 0
  }

  /** Applies `op` to all values in the map. Note: if `op` mutates the map, no guarantees are made
    * as to whether `op` is applied or not to added or removed values. */
  forEach (op :(v:T, p:Path) => void) { this.root.forEach(op, []) }
}
