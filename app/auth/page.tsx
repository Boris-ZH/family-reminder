'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { playClickSound } from '@/lib/sound'

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  
  const router = useRouter()
  const supabase = createClient()

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    playClickSound()
    setError('')
    setLoading(true)

    try {
      if (isLogin) {
        // ВХОД
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        
        // 👈 ВОТ ЭТА СТРОЧКА БЫЛА ПРОПУЩЕНА! 
        // После успешного входа перекидываем на дашборд
        router.push('/dashboard') 
        
      } else {
        // РЕГИСТРАЦИЯ
        const { error } = await supabase.auth.signUp({ 
          email, 
          password,
          options: { data: { full_name: fullName } } 
        })
        if (error) throw error
        alert('Аккаунт создан! Теперь вы можете войти.')
        setIsLogin(true)
      }
    } catch (err: any) {
      setError(err.message || 'Произошла ошибка')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-lg border border-gray-100 p-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-6 text-center">
          {isLogin ? 'С возвращением!' : 'Создать аккаунт'}
        </h1>

        {error && <div className="mb-4 text-sm text-red-500 bg-red-50 p-3 rounded-xl border border-red-100">{error}</div>}

        <form onSubmit={handleAuth} className="space-y-4">
          {!isLogin && (
            <div>
              <label className="block text-sm font-semibold text-gray-600 mb-1">Ваше имя</label>
              <input 
                type="text" required value={fullName} onChange={e => setFullName(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl border border-gray-200 focus:outline-none focus:border-purple-400 bg-gray-50 text-gray-800"
                placeholder="Например: Мама"
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-semibold text-gray-600 mb-1">Email</label>
            <input 
              type="email" required value={email} onChange={e => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-2xl border border-gray-200 focus:outline-none focus:border-purple-400 bg-gray-50 text-gray-800"
              placeholder="mail@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-600 mb-1">Пароль</label>
            <input 
              type="password" required value={password} onChange={e => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-2xl border border-gray-200 focus:outline-none focus:border-purple-400 bg-gray-50 text-gray-800"
              placeholder="••••••••"
            />
          </div>

          <button 
            type="submit" disabled={loading}
            className="w-full py-4 mt-2 bg-purple-200 text-purple-900 font-bold text-lg rounded-2xl active:scale-95 transition-transform disabled:opacity-50"
          >
            {loading ? 'Загрузка...' : isLogin ? 'Войти' : 'Зарегистрироваться'}
          </button>
        </form>

        <button 
          onClick={() => { playClickSound(); setIsLogin(!isLogin); setError(''); }}
          className="w-full mt-4 py-2 text-blue-600 font-semibold active:opacity-50"
        >
          {isLogin ? 'У меня еще нет аккаунта' : 'У меня уже есть аккаунт'}
        </button>
      </div>
    </div>
  )
}