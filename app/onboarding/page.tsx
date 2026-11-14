'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { playClickSound } from '@/lib/sound'

export default function OnboardingPage() {
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [familyName, setFamilyName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  
  const router = useRouter()
  const supabase = createClient()

  const handleAction = async (e: React.FormEvent) => {
    e.preventDefault()
    playClickSound()
    setError('')
    setLoading(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Пользователь не найден. Войдите заново.')

      if (mode === 'create') {
        // 1. Создаем семью
        const { data: family, error: famError } = await supabase
          .from('families')
          .insert({ name: familyName })
          .select()
          .single()
        
        if (famError) throw new Error(`Ошибка при создании семьи: ${famError.message}`)

        // 2. Обновляем профиль (делаем админом)
        const { data: updated, error: profError } = await supabase
          .from('profiles')
          .update({ family_id: family.id, role: 'admin' })
          .eq('id', user.id)
          .select()

        if (profError) throw new Error(`Ошибка базы: ${profError.message}`)
        if (!updated || updated.length === 0) throw new Error('Не удалось обновить профиль (нет прав доступа).')
        
      } else {
        // Присоединяемся по коду
        const code = inviteCode.trim().toLowerCase()
        
        const { data: family, error: famError } = await supabase
          .from('families')
          .select('id')
          .eq('invite_code', code)
          .single()

        if (famError || !family) throw new Error('Семья с таким кодом не найдена')

        // Обновляем профиль (привязываем к семье)
        const { data: updated, error: profError } = await supabase
          .from('profiles')
          .update({ family_id: family.id, role: 'child' })
          .eq('id', user.id)
          .select()

        if (profError) throw new Error(`Ошибка базы: ${profError.message}`)
        if (!updated || updated.length === 0) throw new Error('Не удалось обновить профиль (нет прав доступа).')
      }

      // Если всё прошло успешно — переходим в календарь (дашборд)
      router.push('/dashboard')
      
    } catch (err: any) {
      setError(err.message || 'Ошибка при создании/поиске семьи')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-lg border border-gray-100 p-6">
        <h1 className="text-2xl font-bold text-gray-800 mb-6 text-center">
          Настройка семьи
        </h1>

        {/* Переключатель режимов */}
        <div className="flex bg-gray-100 p-1 rounded-2xl mb-6">
          <button 
            type="button"
            onClick={() => { playClickSound(); setMode('create'); setError(''); }}
            className={`flex-1 py-2 rounded-xl text-sm font-bold transition-colors ${mode === 'create' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500'}`}
          >
            Создать
          </button>
          <button 
            type="button"
            onClick={() => { playClickSound(); setMode('join'); setError(''); }}
            className={`flex-1 py-2 rounded-xl text-sm font-bold transition-colors ${mode === 'join' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500'}`}
          >
            Войти по коду
          </button>
        </div>

        {/* Блок ошибки */}
        {error && (
          <div className="mb-4 text-sm text-red-500 bg-red-50 p-3 rounded-xl border border-red-100">
            {error}
          </div>
        )}

        <form onSubmit={handleAction} className="space-y-4">
          {mode === 'create' ? (
            <div>
              <label className="block text-sm font-semibold text-gray-600 mb-1">Название семьи</label>
              <input 
                type="text" 
                required 
                value={familyName} 
                onChange={e => setFamilyName(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl border border-gray-200 focus:outline-none focus:border-purple-400 bg-gray-50 text-gray-800"
                placeholder="Например: Наша дружная семья"
              />
              <p className="text-xs text-gray-400 mt-2">Вы станете администратором (родителем).</p>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-semibold text-gray-600 mb-1">Код приглашения</label>
              <input 
                type="text" 
                required 
                value={inviteCode} 
                onChange={e => setInviteCode(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl border border-gray-200 focus:outline-none focus:border-blue-400 bg-gray-50 text-gray-800 uppercase"
                placeholder="Например: a1b2c3d4"
              />
              <p className="text-xs text-gray-400 mt-2">Спросите код у того, кто создал семью.</p>
            </div>
          )}

          <button 
            type="submit" 
            disabled={loading}
            className={`w-full py-4 mt-2 font-bold text-lg rounded-2xl active:scale-95 transition-transform disabled:opacity-50 ${
              mode === 'create' ? 'bg-lime-200 text-lime-900' : 'bg-blue-200 text-blue-900'
            }`}
          >
            {loading ? 'Подождите...' : mode === 'create' ? 'Создать семью' : 'Присоединиться'}
          </button>
        </form>
      </div>
    </div>
  )
}