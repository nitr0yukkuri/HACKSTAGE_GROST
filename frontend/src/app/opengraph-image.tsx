import {
  createHoshirubeOgpImage,
  HOSHIRUBE_OGP_ALT,
  HOSHIRUBE_OGP_SIZE,
} from '../lib/ogp/hoshirube-ogp'

export const alt = HOSHIRUBE_OGP_ALT
export const size = HOSHIRUBE_OGP_SIZE
export const contentType = 'image/png'

export default function OpenGraphImage() {
  return createHoshirubeOgpImage()
}
