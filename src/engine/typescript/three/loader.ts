import {FileLoader} from "three"
import {Noop} from "../../../core/util"
import {ResourceLoader} from "../../../asset/loader"

export function threeLoader (baseUrl :string) {
  const loader = new ResourceLoader(baseUrl, (path, loaded, failed) => {
    new FileLoader().load(loader.getUrl(path), data => loaded(data as string), Noop,
                          errev => failed(new Error(errev.message)))
  })
  return loader
}
