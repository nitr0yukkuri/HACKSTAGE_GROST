import styles from './not-found.module.css'

export default function NotFound() {
  return (
    <main className={styles.page}>
      <div className={styles.message} role="status">
        <h1 className={styles.code}>404</h1>
        <p className={styles.description}>This page could not be found.</p>
      </div>
    </main>
  )
}

