import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const HOSHIRUBE_OGP_SIZE = { width: 1200, height: 630 }
export const HOSHIRUBE_OGP_ALT =
  'ほしるべ。本を通して、まだ知らない「好き」に出会う星空の読書案内。'

const heroImageData = await readFile(
  join(process.cwd(), 'public', 'hoshirube-ogp-hero-source.png'),
  'base64',
)
const heroImageSrc = `data:image/png;base64,${heroImageData}`

const stars = [
  { x: 45, y: 76, size: 2, opacity: 0.8 },
  { x: 92, y: 189, size: 3, opacity: 0.7 },
  { x: 132, y: 505, size: 2, opacity: 0.65 },
  { x: 173, y: 112, size: 2, opacity: 0.85 },
  { x: 209, y: 410, size: 3, opacity: 0.6 },
  { x: 1008, y: 65, size: 2, opacity: 0.8 },
  { x: 1051, y: 251, size: 3, opacity: 0.7 },
  { x: 1097, y: 478, size: 2, opacity: 0.8 },
  { x: 1144, y: 147, size: 2, opacity: 0.55 },
  { x: 1173, y: 366, size: 3, opacity: 0.75 },
]

export function createHoshirubeOgpImage() {
  return new ImageResponse(
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background:
          'radial-gradient(ellipse at 50% 44%, #18284e 0%, #101c3b 46%, #09132d 100%)',
      }}
    >
      {stars.map((star, index) => (
        <div
          key={index}
          style={{
            position: 'absolute',
            left: star.x,
            top: star.y,
            width: star.size,
            height: star.size,
            borderRadius: '50%',
            backgroundColor: '#d9eaff',
            opacity: star.opacity,
          }}
        />
      ))}
      <div
        style={{
          position: 'absolute',
          left: 1018,
          top: 174,
          width: 108,
          height: 1,
          transform: 'rotate(-42deg)',
          background:
            'linear-gradient(90deg, rgba(160,198,255,0), rgba(160,198,255,0.7))',
        }}
      />
      <div
        style={{
          position: 'relative',
          display: 'flex',
          width: 816,
          height: 630,
          overflow: 'hidden',
          borderRadius: 12,
          border: '1px solid rgba(164, 194, 255, 0.24)',
          boxShadow: '0 18px 70px rgba(0, 0, 0, 0.38)',
        }}
      >
        <img
          src={heroImageSrc}
          width="816"
          height="630"
          style={{ width: '816px', height: '630px', objectFit: 'cover' }}
        />
      </div>
    </div>,
    HOSHIRUBE_OGP_SIZE,
  )
}
