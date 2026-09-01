import { redirect } from 'next/navigation'

// The Console is the product. Nothing lives at the root.
export default function Home() {
  redirect('/console')
}
