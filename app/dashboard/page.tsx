'use client'
import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { playClickSound, playSuccessSound } from '@/lib/sound'

export default function DashboardPage() {
  const [profile, setProfile] = useState<any>(null)
  const [familyCode, setFamilyCode] = useState('')
  const [events, setEvents] = useState<any[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  
  const [view, setView] = useState<'today' | 'tomorrow' | 'week' | 'month' | 'year'>('today')
  
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newDate, setNewDate] = useState('')
  const [newTime, setNewTime] = useState('')
  const [newRecurrence, setNewRecurrence] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none')
  const [modalError, setModalError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [selectedEvent, setSelectedEvent] = useState<any>(null)

  const [familyMembers, setFamilyMembers] = useState<any[]>([])
  const [isFamilyModalOpen, setIsFamilyModalOpen] = useState(false)
  const [isCopied, setIsCopied] = useState(false)

  // 👇 Состояние для темы
  const [isDark, setIsDark] = useState(false)

  const router = useRouter()
  const supabase = createClient()

  // 👇 Загрузка и применение темы
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme')
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
      setIsDark(true)
      document.documentElement.classList.add('dark')
    } else {
      setIsDark(false)
      document.documentElement.classList.remove('dark')
    }
  }, [])

  // 👇 Функция переключения темы
  const toggleTheme = () => {
    playClickSound()
    if (isDark) {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('theme', 'light')
      setIsDark(false)
    } else {
      document.documentElement.classList.add('dark')
      localStorage.setItem('theme', 'dark')
      setIsDark(true)
    }
  }

  const fetchData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/auth')
        return
      }

      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, role, family_id')
        .eq('id', user.id)
        .maybeSingle()

      if (profileError) throw new Error(profileError.message)
      if (!profileData) {
        router.push('/onboarding')
        return
      }
      setProfile(profileData)

      if (profileData.family_id) {
        const { data: familyData } = await supabase
          .from('families')
          .select('invite_code')
          .eq('id', profileData.family_id)
          .maybeSingle()
        
        if (familyData) setFamilyCode(familyData.invite_code)

        const { data: eventsData, error: eventsError } = await supabase
          .from('events')
          .select(`
            *,
            creator:profiles!created_by(full_name),
            event_acknowledgements (
              user_id,
              is_completed,
              profiles (full_name)
            )
          `)
          .eq('family_id', profileData.family_id)
          .order('event_time', { ascending: true })
          
        if (eventsError) throw new Error(eventsError.message)
        setEvents(eventsData || [])

        const { data: membersData } = await supabase
          .from('profiles')
          .select('id, full_name, role')
          .eq('family_id', profileData.family_id)
        
        if (membersData) setFamilyMembers(membersData)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [router, supabase])

  const handleLogout = async () => {
    playClickSound()
    await supabase.auth.signOut()
    router.push('/auth')
  }

  const copyCodeToClipboard = () => {
    navigator.clipboard.writeText(familyCode)
    setIsCopied(true)
    playClickSound()
    setTimeout(() => setIsCopied(false), 2000)
  }

  const openCreateModal = () => {
    playClickSound()
    setEditingId(null)
    setNewTitle('')
    setNewDesc('')
    setNewDate('')
    setNewTime('')
    setNewRecurrence('none')
    setModalError('')
    setIsModalOpen(true)
  }

  const openEditModal = (ev: any) => {
    playClickSound()
    setEditingId(ev.id)
    setNewTitle(ev.title)
    setNewDesc(ev.description || '')
    const d = new Date(ev.event_time)
    setNewDate(d.toISOString().split('T')[0])
    setNewTime(d.toTimeString().slice(0, 5))
    setNewRecurrence(ev.recurrence_rule || 'none')
    setModalError('')
    setSelectedEvent(null)
    setIsModalOpen(true)
  }

  const closeCreateModal = () => {
    setIsModalOpen(false)
    setEditingId(null)
  }

  const handleSaveEvent = async (e: React.FormEvent) => {
    e.preventDefault()
    setModalError('')

    if (!newDate || !newTime) {
      setModalError('Выберите дату и время')
      return
    }

    const eventDateTimeObj = new Date(`${newDate}T${newTime}`)
    if (!editingId && eventDateTimeObj < new Date()) {
      setModalError('Нельзя создавать события в прошедшем времени!')
      return
    }

    setIsSubmitting(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Не удалось подтвердить пользователя')

      const eventDateTime = eventDateTimeObj.toISOString()
      const eventData = {
        title: newTitle,
        description: newDesc,
        event_time: eventDateTime,
        recurrence_rule: newRecurrence === 'none' ? null : newRecurrence
      }

      if (editingId) {
        const { error } = await supabase.from('events').update(eventData).eq('id', editingId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('events').insert({
          ...eventData,
          family_id: profile.family_id,
          created_by: user.id,
        })
        if (error) throw error
      }
      
      playSuccessSound()
      closeCreateModal()
      fetchData()
    } catch (err: any) {
      setModalError('Ошибка при сохранении: ' + err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const toggleComplete = async (eventId: string, currentStatus: boolean) => {
    playClickSound()
    try {
      const { error } = await supabase
        .from('event_acknowledgements')
        .upsert({
          event_id: eventId,
          user_id: profile.id,
          is_completed: !currentStatus,
          updated_at: new Date().toISOString()
        })
      if (error) throw error
      fetchData()
      if (selectedEvent && selectedEvent.id === eventId) {
        setSelectedEvent(null)
      }
    } catch (err: any) {
      alert('Ошибка: ' + err.message)
    }
  }

  const cancelEvent = async (eventId: string) => {
    if (profile.role !== 'admin') return alert('Отменять события могут только родители!')
    if (!confirm('Отменить это событие? Оно останется в списке, но будет перечеркнуто.')) return
    
    playClickSound()
    try {
      const { error } = await supabase.from('events').update({ status: 'cancelled' }).eq('id', eventId)
      if (error) throw error
      setSelectedEvent(null)
      fetchData()
    } catch (err: any) {
      alert('Ошибка: ' + err.message)
    }
  }

  const deleteEvent = async (eventId: string) => {
    if (profile.role !== 'admin') return alert('Удалять события могут только родители!')
    if (!confirm('Вы уверены, что хотите удалить это событие навсегда?')) return
    
    playClickSound()
    try {
      const { error } = await supabase.from('events').delete().eq('id', eventId)
      if (error) throw error
      setSelectedEvent(null)
      fetchData()
    } catch (err: any) {
      alert('Ошибка удаления: ' + err.message)
    }
  }

  const filteredEvents = useMemo(() => {
    const now = new Date()
    let startLimit = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    let endLimit = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)

    if (view === 'tomorrow') {
      startLimit.setDate(startLimit.getDate() + 1)
      endLimit.setDate(endLimit.getDate() + 1)
    } else if (view === 'week') {
      endLimit.setDate(endLimit.getDate() + (7 - now.getDay()))
    } else if (view === 'month') {
      endLimit = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
    } else if (view === 'year') {
      startLimit = new Date(now.getFullYear(), 0, 1)
      endLimit = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999)
    }

    const expanded: any[] = []
    events.forEach(ev => {
      const evDate = new Date(ev.event_time)
      if (!ev.recurrence_rule) {
        if (evDate >= startLimit && evDate <= endLimit) expanded.push(ev)
        return
      }
      let current = new Date(evDate)
      let safetyCounter = 0
      while (current <= endLimit && safetyCounter < 365) {
        if (current >= startLimit) {
          expanded.push({ ...ev, event_time: current.toISOString(), is_recurrence: true })
        }
        if (ev.recurrence_rule === 'daily') current.setDate(current.getDate() + 1)
        else if (ev.recurrence_rule === 'weekly') current.setDate(current.getDate() + 7)
        else if (ev.recurrence_rule === 'monthly') current.setMonth(current.getMonth() + 1)
        else break
        safetyCounter++
      }
    })
    return expanded.sort((a, b) => new Date(a.event_time).getTime() - new Date(b.event_time).getTime())
  }, [events, view])

  if (loading) return <div className="min-h-screen bg-white dark:bg-slate-900 flex items-center justify-center text-gray-400 dark:text-slate-500">Загрузка...</div>
  if (error) return <div className="p-8 text-center text-red-500">{error}</div>
  if (!profile) return null

  const formatTime = (isoString: string) => new Date(isoString).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const formatDate = (isoString: string) => new Date(isoString).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  const formatCreatedAt = (isoString: string) => new Date(isoString).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  const isCompletedByMe = (event: any) => event.event_acknowledgements?.some((ack: any) => ack.user_id === profile.id && ack.is_completed)
  const countCompleted = (event: any) => event.event_acknowledgements?.filter((ack: any) => ack.is_completed).length || 0

  return (
    <div className="h-[100dvh] w-full overflow-y-auto bg-white dark:bg-slate-900 transition-colors duration-300 relative">
      <div className="max-w-md mx-auto p-4 pb-24 mt-6">
        
        <div className="flex justify-between items-center mb-6 bg-slate-800 dark:bg-slate-950 p-4 rounded-3xl shadow-md transition-colors duration-300">
          <div>
            <h1 className="text-xl font-bold text-slate-100">Привет, {profile.full_name}!</h1>
            <p className="text-slate-300 text-sm font-medium">Роль: {profile.role === 'admin' ? 'Родитель' : 'Ребенок'}</p>
          </div>
          <div className="flex gap-2">
            {/* 👇 Кнопка переключения темы */}
            <button onClick={toggleTheme} className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-100 font-bold rounded-xl shadow-sm text-sm active:scale-95 transition-all">
              {isDark ? '☀️' : '🌙'}
            </button>
            <button onClick={() => { playClickSound(); setIsFamilyModalOpen(true) }} className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-100 font-bold rounded-xl shadow-sm text-sm active:scale-95 transition-all" title="Наша семья">
              👨‍👩‍👧‍👦
            </button>
            <button onClick={handleLogout} className="px-4 py-2 bg-white text-red-500 font-bold rounded-xl shadow-sm text-sm active:scale-95 transition-transform">Выйти</button>
          </div>
        </div>

        <div className="flex gap-2 mb-6 overflow-x-auto pb-2 scrollbar-hide">
          {(['today', 'tomorrow', 'week', 'month', 'year'] as const).map(v => (
            <button key={v} onClick={() => { playClickSound(); setView(v) }} className={`px-4 py-2 rounded-2xl font-bold whitespace-nowrap transition-transform active:scale-95 ${view === v ? 'bg-slate-800 dark:bg-slate-700 text-white shadow-sm' : 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400'}`}>
              {v === 'today' && 'Сегодня'}
              {v === 'tomorrow' && 'Завтра'}
              {v === 'week' && 'Неделя'}
              {v === 'month' && 'Месяц'}
              {v === 'year' && 'Год'}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {filteredEvents.length === 0 ? (
            <div className="text-center text-gray-400 dark:text-slate-500 mt-10 bg-gray-50 dark:bg-slate-800/50 p-6 rounded-3xl border border-dashed border-gray-200 dark:border-slate-700">
              <p className="text-4xl mb-2">🎉</p>
              <p>На этот период событий нет.</p>
            </div>
          ) : (
            filteredEvents.map((ev, index) => {
              const done = isCompletedByMe(ev)
              const totalDone = countCompleted(ev)
              const isCancelled = ev.status === 'cancelled'

              return (
                <div 
                  key={`${ev.id}-${index}`} 
                  onClick={() => { playClickSound(); setSelectedEvent(ev) }} 
                  className={`bg-white dark:bg-slate-800 border shadow-sm rounded-2xl p-4 flex gap-4 items-start cursor-pointer active:scale-[0.98] transition-all ${
                    isCancelled ? 'border-red-100 dark:border-red-900/50 bg-red-50/20 dark:bg-red-900/10 opacity-70' : 
                    done ? 'border-green-200 dark:border-green-900/50 bg-green-50/30 dark:bg-green-900/10' : 
                    'border-gray-100 dark:border-slate-700'
                  }`}
                >
                  <div className={`px-3 py-2 rounded-xl text-center min-w-[70px] ${
                    isCancelled ? 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-200' :
                    done ? 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-200' : 
                    'bg-purple-50 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300'
                  }`}>
                    <div className={`text-lg font-bold leading-none ${isCancelled ? 'line-through' : ''}`}>{formatTime(ev.event_time)}</div>
                    <div className="text-xs font-semibold mt-1 opacity-70">{formatDate(ev.event_time)}</div>
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <h3 className={`font-bold text-lg leading-tight truncate ${
                        isCancelled ? 'text-red-500 line-through' :
                        done ? 'text-gray-400 dark:text-slate-500 line-through' : 'text-gray-800 dark:text-slate-100'
                      }`}>
                        {ev.title}
                      </h3>
                      {ev.recurrence_rule && <span title="Повторяющееся событие">🔄</span>}
                    </div>
                    {ev.description && <p className={`text-sm mt-1 line-clamp-1 ${isCancelled ? 'text-red-400' : 'text-gray-500 dark:text-slate-400'}`}>{ev.description}</p>}
                    
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      {isCancelled ? (
                         <span className="text-red-600 dark:text-red-400 font-bold">Отменено</span>
                      ) : (
                        <>
                          <span className="text-gray-400 dark:text-slate-500">Выполнили: {totalDone}</span>
                          {done && <span className="text-green-600 dark:text-green-400 font-bold">✓ Выполнено</span>}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      <button 
        onClick={openCreateModal}
        className="fixed bottom-6 right-6 w-16 h-16 rounded-full bg-lime-300 dark:bg-lime-600 text-lime-900 dark:text-white shadow-xl flex items-center justify-center active:scale-90 transition-transform z-[100]"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className="w-8 h-8">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
      </button>

      {isFamilyModalOpen && (
        <div className="fixed inset-0 bg-black/40 dark:bg-black/60 flex items-center justify-center p-4 z-[200]" onClick={() => setIsFamilyModalOpen(false)}>
          <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-3xl p-6 shadow-2xl relative" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setIsFamilyModalOpen(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl font-bold p-2">×</button>
            <h2 className="text-2xl font-bold text-gray-800 dark:text-slate-100 mb-4 pr-6">Наша семья</h2>
            
            {profile.role === 'admin' && (
              <div className="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-2xl mb-6 border border-transparent dark:border-purple-900/50">
                <p className="text-sm text-purple-800 dark:text-purple-300 font-semibold mb-2 text-center">Код для приглашения:</p>
                <div className="flex gap-2">
                  <div className="flex-1 text-2xl font-mono font-bold tracking-widest text-purple-900 dark:text-purple-200 text-center bg-white dark:bg-slate-900 py-2 rounded-xl border border-purple-100 dark:border-slate-700 flex items-center justify-center">
                    {familyCode}
                  </div>
                  <button 
                    onClick={copyCodeToClipboard}
                    className={`px-4 py-2 rounded-xl text-sm font-bold transition-all active:scale-95 ${
                      isCopied ? 'bg-green-200 dark:bg-green-700 text-green-900 dark:text-white' : 'bg-purple-200 dark:bg-purple-700 text-purple-900 dark:text-white'
                    }`}
                  >
                    {isCopied ? 'Готово ✓' : 'Копировать'}
                  </button>
                </div>
                <p className="text-xs text-purple-500 dark:text-purple-400 mt-2 text-center">Отправьте его детям, чтобы они могли присоединиться.</p>
              </div>
            )}

            <div className="space-y-3">
              {familyMembers.map(member => (
                <div key={member.id} className="flex items-center justify-between bg-gray-50 dark:bg-slate-700/50 p-3 rounded-xl">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-600 flex items-center justify-center text-xl">
                      {member.role === 'admin' ? '👨‍🍼' : '🧒'}
                    </div>
                    <div>
                      <p className="font-bold text-gray-800 dark:text-slate-100">{member.full_name}</p>
                      <p className="text-xs text-gray-500 dark:text-slate-400">{member.role === 'admin' ? 'Родитель' : 'Ребенок'}</p>
                    </div>
                  </div>
                  {member.id === profile.id && <span className="text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 px-2 py-1 rounded-lg font-bold">Это вы</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/40 dark:bg-black/60 flex items-center justify-center p-4 z-[200]" onClick={closeCreateModal}>
          <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-3xl p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-2xl font-bold text-gray-800 dark:text-slate-100 mb-4">
              {editingId ? 'Редактировать событие' : 'Новое событие'}
            </h2>
            {modalError && <div className="mb-4 text-sm text-red-500 bg-red-50 dark:bg-red-900/30 p-3 rounded-xl">{modalError}</div>}
            
            <form onSubmit={handleSaveEvent} className="space-y-3">
              <div>
                <label className="block text-sm font-semibold text-gray-600 dark:text-slate-300 mb-1">Название</label>
                <input type="text" required value={newTitle} onChange={e => setNewTitle(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-slate-600 focus:border-lime-400 dark:focus:border-lime-500 bg-gray-50 dark:bg-slate-700 text-gray-800 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-400" placeholder="Сходить в кино" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-600 dark:text-slate-300 mb-1">Описание</label>
                <input type="text" value={newDesc} onChange={e => setNewDesc(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-slate-600 focus:border-lime-400 dark:focus:border-lime-500 bg-gray-50 dark:bg-slate-700 text-gray-800 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-400" placeholder="Взять попкорн" />
              </div>
              
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-sm font-semibold text-gray-600 dark:text-slate-300 mb-1">Дата</label>
                  <input type="date" required value={newDate} onChange={e => setNewDate(e.target.value)} className="w-full px-3 py-3 rounded-xl border border-gray-200 dark:border-slate-600 focus:border-lime-400 dark:focus:border-lime-500 bg-gray-50 dark:bg-slate-700 text-gray-800 dark:text-slate-100" />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-semibold text-gray-600 dark:text-slate-300 mb-1">Время</label>
                  <input type="time" required value={newTime} onChange={e => setNewTime(e.target.value)} className="w-full px-3 py-3 rounded-xl border border-gray-200 dark:border-slate-600 focus:border-lime-400 dark:focus:border-lime-500 bg-gray-50 dark:bg-slate-700 text-gray-800 dark:text-slate-100" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-600 dark:text-slate-300 mb-1">Повторение</label>
                <select 
                  value={newRecurrence} 
                  onChange={e => setNewRecurrence(e.target.value as any)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-slate-600 focus:outline-none focus:border-lime-400 dark:focus:border-lime-500 bg-gray-50 dark:bg-slate-700 text-gray-800 dark:text-slate-100"
                >
                  <option value="none">Не повторять</option>
                  <option value="daily">Каждый день</option>
                  <option value="weekly">Каждую неделю</option>
                  <option value="monthly">Каждый месяц</option>
                </select>
              </div>

              <div className="flex gap-3 mt-6">
                <button type="button" onClick={closeCreateModal} className="flex-1 py-3 bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 font-bold rounded-xl active:scale-95 transition-transform">Отмена</button>
                <button type="submit" disabled={isSubmitting} className="flex-1 py-3 bg-lime-300 dark:bg-lime-600 text-lime-900 dark:text-white font-bold rounded-xl active:scale-95 transition-transform">{isSubmitting ? '...' : 'Сохранить'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedEvent && (
        <div className="fixed inset-0 bg-black/40 dark:bg-black/60 flex items-center justify-center p-4 z-[200]" onClick={() => setSelectedEvent(null)}>
          <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-3xl p-6 shadow-2xl relative" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setSelectedEvent(null)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl font-bold p-2">×</button>
            
            <div className="flex items-start gap-2 pr-6 mb-2">
              <h2 className={`text-2xl font-bold break-words ${selectedEvent.status === 'cancelled' ? 'text-red-500 line-through' : 'text-gray-800 dark:text-slate-100'}`}>
                {selectedEvent.title}
              </h2>
              {selectedEvent.recurrence_rule && <span className="text-xl mt-1" title="Повторяющееся событие">🔄</span>}
            </div>
            
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">{formatDate(selectedEvent.event_time)} в {formatTime(selectedEvent.event_time)}</p>
            
            {selectedEvent.status === 'cancelled' && (
               <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 p-3 rounded-xl mb-4 font-bold text-center">
                 Это событие отменено
               </div>
            )}

            {selectedEvent.description && (
              <div className="bg-gray-50 dark:bg-slate-700/50 p-4 rounded-xl mb-6">
                <p className="text-gray-700 dark:text-slate-300 whitespace-pre-wrap break-words">{selectedEvent.description}</p>
              </div>
            )}

            {selectedEvent.status !== 'cancelled' && (
              <>
                {selectedEvent.recurrence_rule && (
                  <p className="text-xs text-purple-600 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/30 p-2 rounded-lg mb-4 text-center">
                    Это повторяющееся событие. Отметка о выполнении применится ко всей серии.
                  </p>
                )}

                <div className="mb-6">
                  <h4 className="text-sm font-bold text-gray-600 dark:text-slate-300 mb-2">Кто выполнил:</h4>
                  <div className="flex flex-col gap-2">
                    {selectedEvent.event_acknowledgements?.filter((a:any) => a.is_completed).length > 0 ? (
                      selectedEvent.event_acknowledgements.filter((a:any) => a.is_completed).map((ack: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 text-sm text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/30 px-3 py-2 rounded-lg"><span>✓</span> {ack.profiles?.full_name}</div>
                      ))
                    ) : (
                      <p className="text-sm text-gray-400 dark:text-slate-500">Пока никто не отметил</p>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <button 
                    onClick={() => toggleComplete(selectedEvent.id, isCompletedByMe(selectedEvent))}
                    className={`w-full py-4 rounded-xl font-bold text-lg transition-colors ${
                      isCompletedByMe(selectedEvent) ? 'bg-gray-200 dark:bg-slate-700 text-gray-600 dark:text-slate-300' : 'bg-green-300 dark:bg-green-600 text-green-900 dark:text-white'
                    }`}
                  >
                    {isCompletedByMe(selectedEvent) ? 'Отменить выполнение' : 'Отметить выполненным'}
                  </button>
                </div>
              </>
            )}

            <div className="mt-6 pt-4 border-t border-gray-100 dark:border-slate-700 text-xs text-gray-400 dark:text-slate-500 text-center">
              Добавил(а) {selectedEvent.creator?.full_name || 'Неизвестный'} <br/>
              {formatCreatedAt(selectedEvent.created_at)}
            </div>

            {profile.role === 'admin' && (
              <div className="mt-4 pt-4 border-t border-gray-100 dark:border-slate-700 flex flex-col gap-2">
                <button onClick={() => openEditModal(selectedEvent)} className="w-full py-3 rounded-xl font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 active:scale-95 transition-transform">Редактировать</button>
                {selectedEvent.status !== 'cancelled' && (
                  <button onClick={() => cancelEvent(selectedEvent.id)} className="w-full py-3 rounded-xl font-bold text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/30 active:scale-95 transition-transform">Отменить событие</button>
                )}
                <button onClick={() => deleteEvent(selectedEvent.id)} className="w-full py-3 rounded-xl font-bold text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/30 active:scale-95 transition-transform">Удалить навсегда</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}