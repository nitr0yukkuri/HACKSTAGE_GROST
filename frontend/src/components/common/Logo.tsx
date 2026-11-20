import Image from 'next/image'

type LogoProps = {
  size?: number
  stroke?: number
  label?: boolean
}

export default function Logo({
  size = 56,
  label = false,
}: LogoProps) {
  const width = Math.round(size * 1.35)

  return (
    <>
      <span
        className="hoshirube-logo"
        style={{ width, height: size }}
      >
        <Image
        src="/hoshirube-logo-v2.png"
        alt=""
        aria-hidden="true"
        width={width}
        height={size}
        priority
        style={{
          width,
          height: size,
          objectFit: 'contain',
        }}
      />
        <Image
          src="/hoshirube-star-glow.png"
          alt=""
          aria-hidden="true"
          width={width}
          height={size}
          className="hoshirube-logo__star-glow"
          style={{ width, height: size }}
        />
      </span>
      {label && <span>ほしるべ</span>}
    </>
  )
}
