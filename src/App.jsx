import React, { useRef, useEffect, useState, useCallback } from 'react'
import * as tf from '@tensorflow/tfjs'
import * as blazeface from '@tensorflow-models/blazeface'

const W = 640, H = 480
const CATCH_R = 65
const GOOD = ['🍕','🍔','🍣','🍩','🍎','🍓','🌮','🍜','🧁','🍦','🍒','🥐','🍇','🍉','🧆','🌯']
const BAD  = ['💣','☠️','🤢','🦠','💩']

export default function App() {
  const videoRef   = useRef(null)
  const canvasRef  = useRef(null)
  const modelRef   = useRef(null)
  const stateRef   = useRef({
    emojis:[], score:0, lives:3,
    fx:W/2, fy:H/2,
    running:false, over:false,
    lastSpawn:0, detecting:false,
  })
  const rafRef = useRef(null)

  const [phase,  setPhase]  = useState('title')  // title | loading | play | over
  const [score,  setScore]  = useState(0)
  const [lives,  setLives]  = useState(3)
  const [status, setStatus] = useState('')

  /* ── 顔検出ループ（別setInterval） ── */
  const detectLoop = useCallback(async () => {
    const s = stateRef.current
    const v = videoRef.current
    if (!s.running || s.detecting || !modelRef.current) return
    if (!v || v.readyState < 2) return
    s.detecting = true
    try {
      const preds = await modelRef.current.estimateFaces(v, false)
      if (preds.length > 0) {
        const [tlX, tlY] = preds[0].topLeft
        const [brX, brY] = preds[0].bottomRight
        s.fx = W - (tlX + brX) / 2   // 鏡像補正
        s.fy = (tlY + brY) / 2
      }
    } catch(_){}
    s.detecting = false
  }, [])

  /* ── ゲームループ（rAF） ── */
  const loop = useCallback(() => {
    const s = stateRef.current
    if (!s.running) return

    const canvas = canvasRef.current
    const video  = videoRef.current
    const ctx    = canvas.getContext('2d')

    /* 背景：カメラ映像（鏡像） */
    ctx.save()
    ctx.scale(-1, 1)
    ctx.drawImage(video, -W, 0, W, H)
    ctx.restore()
    ctx.fillStyle = 'rgba(0,0,0,0.18)'
    ctx.fillRect(0, 0, W, H)

    /* 絵文字スポーン */
    const now = Date.now()
    const interval = Math.max(500, 1400 - s.score * 8)
    if (now - s.lastSpawn > interval) {
      const bad = Math.random() < 0.22
      s.emojis.push({
        x: 30 + Math.random() * (W - 60),
        y: -35,
        e: bad ? BAD[Math.floor(Math.random()*BAD.length)] : GOOD[Math.floor(Math.random()*GOOD.length)],
        bad,
        spd: 2.2 + s.score * 0.025 + Math.random() * 1.5,
        size: 38,
      })
      s.lastSpawn = now
    }

    /* 絵文字更新・描画・判定 */
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const dead = []
    for (let i = s.emojis.length - 1; i >= 0; i--) {
      const em = s.emojis[i]
      em.y += em.spd
      ctx.font = `${em.size}px serif`
      ctx.fillText(em.e, em.x, em.y)

      const dx = em.x - s.fx, dy = em.y - s.fy
      if (dx*dx + dy*dy < CATCH_R*CATCH_R) {
        if (em.bad) {
          s.lives = Math.max(0, s.lives - 1)
          setLives(s.lives)
          if (s.lives === 0) { endGame(); return }
        } else {
          s.score++
          setScore(s.score)
        }
        dead.push(i)
      } else if (em.y > H + 50) {
        dead.push(i)
      }
    }
    dead.forEach(i => s.emojis.splice(i, 1))

    /* 顔インジケーター */
    ctx.beginPath()
    ctx.arc(s.fx, s.fy, CATCH_R, 0, Math.PI*2)
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.font = '44px serif'
    ctx.fillText('😋', s.fx, s.fy)

    /* HUD */
    ctx.fillStyle = 'rgba(0,0,0,0.5)'
    ctx.fillRect(0, 0, W, 52)
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 22px "Helvetica Neue",sans-serif'
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
    ctx.fillText(`スコア: ${s.score}`, 16, 26)
    ctx.textAlign = 'right'
    ctx.fillText('❤️'.repeat(Math.max(0, s.lives)), W - 12, 26)

    rafRef.current = requestAnimationFrame(loop)
  }, [])

  /* ── ゲーム終了 ── */
  const endGame = useCallback(() => {
    const s = stateRef.current
    s.running = false
    cancelAnimationFrame(rafRef.current)
    setPhase('over')
  }, [])

  /* ── スタート ── */
  const startGame = async () => {
    setPhase('loading')
    setStatus('📷 カメラを起動中...')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode:'user', width:W, height:H }
      })
      const v = videoRef.current
      v.srcObject = stream
      await new Promise(res => v.addEventListener('loadeddata', res, { once:true }))

      setStatus('🧠 AI読み込み中...')
      await tf.ready()
      modelRef.current = await blazeface.load()

      /* ゲーム状態リセット */
      const s = stateRef.current
      s.emojis = []; s.score = 0; s.lives = 3
      s.fx = W/2; s.fy = H/2
      s.running = true; s.over = false
      s.lastSpawn = 0; s.detecting = false
      setScore(0); setLives(3)
      setPhase('play')

      /* 顔検出 100ms間隔 */
      const det = setInterval(detectLoop, 100)
      /* クリーンアップ登録 */
      stateRef.current._clearDet = () => clearInterval(det)

      requestAnimationFrame(loop)
    } catch(err) {
      setStatus(`エラー: ${err.message}`)
      setTimeout(() => setPhase('title'), 3000)
    }
  }

  /* アンマウント時クリーンアップ */
  useEffect(() => () => {
    stateRef.current.running = false
    stateRef.current._clearDet?.()
    cancelAnimationFrame(rafRef.current)
  }, [])

  /* ── UI ── */
  const boxStyle = {
    width:W, height:H, background:'#1a1a2e',
    borderRadius:18, display:'flex', flexDirection:'column',
    alignItems:'center', justifyContent:'center', gap:22,
  }

  return (
    <div style={{
      minHeight:'100vh', background:'linear-gradient(135deg,#0f0c29,#302b63,#24243e)',
      display:'flex', flexDirection:'column', alignItems:'center',
      justifyContent:'center', fontFamily:'"Helvetica Neue",sans-serif', color:'#fff',
      padding:16,
    }}>
      <h1 style={{ fontSize:26, fontWeight:800, margin:'0 0 16px', letterSpacing:1 }}>
        😋 絵文字キャッチゲーム
      </h1>

      <div style={{ position:'relative' }}>
        <video ref={videoRef} autoPlay muted playsInline
          style={{ display:'none' }} width={W} height={H} />

        <canvas ref={canvasRef} width={W} height={H}
          style={{ borderRadius:18, display: phase==='play' ? 'block' : 'none',
            maxWidth:'100%', boxShadow:'0 8px 40px rgba(0,0,0,0.5)' }} />

        {/* タイトル */}
        {phase === 'title' && (
          <div style={boxStyle}>
            <div style={{ fontSize:72 }}>😋</div>
            <div style={{ textAlign:'center', color:'#ccc', fontSize:15, lineHeight:1.9, maxWidth:340 }}>
              インカメラで顔を認識！<br/>
              降ってくる絵文字に顔を近づけて食べよう！<br/>
              <span style={{ color:'#ff6b9d' }}>💣 ☠️ は避けてね！</span>
            </div>
            <button onClick={startGame} style={{
              background:'linear-gradient(135deg,#ff6b9d,#ff8c42)',
              border:'none', borderRadius:14, padding:'14px 48px',
              fontSize:18, fontWeight:800, color:'#fff', cursor:'pointer',
              boxShadow:'0 4px 20px rgba(255,107,157,0.5)',
            }}>🎮 スタート！</button>
          </div>
        )}

        {/* ローディング */}
        {phase === 'loading' && (
          <div style={boxStyle}>
            <div style={{ fontSize:56 }}>⏳</div>
            <div style={{ fontSize:18, color:'#aaa' }}>{status}</div>
          </div>
        )}

        {/* ゲームオーバー */}
        {phase === 'over' && (
          <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.82)',
            borderRadius:18, display:'flex', flexDirection:'column',
            alignItems:'center', justifyContent:'center', gap:20 }}>
            <div style={{ fontSize:68 }}>💀</div>
            <div style={{ fontSize:30, fontWeight:800 }}>ゲームオーバー！</div>
            <div style={{ fontSize:24, color:'#ffd700' }}>スコア: {score} 点</div>
            <button onClick={startGame} style={{
              background:'linear-gradient(135deg,#43e97b,#38f9d7)',
              border:'none', borderRadius:14, padding:'13px 44px',
              fontSize:17, fontWeight:800, color:'#111', cursor:'pointer',
            }}>🔄 もう一回！</button>
          </div>
        )}
      </div>

      {phase === 'play' && (
        <p style={{ marginTop:12, fontSize:13, color:'#666' }}>
          顔を動かして絵文字に近づけよう • 💣は避けて！
        </p>
      )}
    </div>
  )
}
