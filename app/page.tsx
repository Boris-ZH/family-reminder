'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

export default function Home() {
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/auth')
        return
      }

      // Проверяем, есть ли у пользователя семья
      const { data: profile } = await supabase
        .from('profiles')
        .select('family_id')
        .eq('id', session.user.id)
        .single()

      if (!profile?.family_id) {
        router.push('/onboarding')
      } else {
        router.push('/dashboard')
      }
    }
    checkUser()
  }, [router, supabase])

  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-purple-600 text-xl font-bold animate-pulse">
        Загрузка...
      </div>
    </div>
  )
}