import React, { useRef, useEffect, useState, useCallback } from 'react'
import * as tf from '@tensorflow/tfjs'
import * as blazeface from '@tensorflow-models/blazeface'

const W = 640, H = 360   // 16:9に変更（カメラと同じアスペクト比）
const CATCH_R = 65
const GOOD = ['🍕','🍔','🍣','🍩','🍎','🍓','🌮','🍜','🧁','🍦','🍒','🥐','🍇','🍉','🧆','🌯']
const BAD  = ['💣','☠️','🤢','🦠','💩']

export default function App() {
  const videoRef  = useRef(null)
  const canvasRef = useRef(null)
  const modelRef  = useRef(null)
  const rafRef    = useRef(null)
  const detRef    = useRef(null)  // setInterval id
  const gRef      = useRef({
    emojis:[], score:0, lives:3,
    fx:W/2, fy:H/2,
    running:false, detecting:false,
    lastSpawn:0,
    vscale:1, vox:0, voy:0,   // ビデオ→Canvas変換係数
  })

  const [phase,  setPhase]  = useState('title')
  const [score,  setScore]  = useState(0)
  const [lives,  setLives]  = useState(3)
  const [dbg,    setDbg]    = useState('')   // デバッグ表示

  /* ── 顔検出（100ms間隔） ── */
  const runDetect = useCallback(async () => {
    const g = gRef.current
    if (!g.running || g.detecting) return
    const v = videoRef.current
    const m = modelRef.current
    if (!v || !m || v.readyState < 2 || v.paused) return
    g.detecting = true
    try {
      const preds = await m.estimateFaces(v, false /* returnTensors */)
      if (preds.length > 0) {
        const p = preds[0]
        // BlazeFace landmarks: [右目, 左目, 鼻, 口, 右耳, 左耳]
        const mouth = p.landmarks[3]   // 口の座標
        const rawX  = mouth[0]
        const rawY  = mouth[1]
        // ビデオ座標 → Canvas座標（スケール＋オフセット＋鏡像）
        g.fx = W - (rawX * g.vscale + g.vox)
        g.fy = rawY * g.vscale + g.voy
        setDbg(`口検出 ✅ (${Math.round(g.fx)}, ${Math.round(g.fy)})`)
      } else {
        setDbg('顔を映してください 👀')
      }
    } catch(e) {
      setDbg('検出エラー: ' + e.message)
    }
    g.detecting = false
  }, [])

  /* ── ゲームループ ── */
  const loop = useCallback(() => {
    const g = gRef.current
    if (!g.running) return

    const canvas = canvasRef.current
    const video  = videoRef.current
    if (!canvas || !video || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(loop)
      return
    }

    const ctx = canvas.getContext('2d')

    // カメラ映像（鏡像・アスペクト比を保持してfill）
    const vw = video.videoWidth  || W
    const vh = video.videoHeight || H
    const scale = Math.max(W / vw, H / vh)
    const sw = vw * scale, sh = vh * scale
    const ox = (W - sw) / 2,  oy = (H - sh) / 2
    // 顔検出側でも使うので保存
    g.vscale = scale; g.vox = ox; g.voy = oy
    ctx.save()
    ctx.scale(-1, 1)
    ctx.drawImage(video, -(ox + sw), oy, sw, sh)
    ctx.restore()
    ctx.fillStyle = 'rgba(0,0,0,0.15)'
    ctx.fillRect(0, 0, W, H)

    // スポーン
    const now = Date.now()
    const interval = Math.max(500, 1400 - g.score * 8)
    if (now - g.lastSpawn > interval) {
      const bad = Math.random() < 0.22
      g.emojis.push({
        x: 40 + Math.random() * (W - 80),
        y: -40,
        e: bad ? BAD[Math.floor(Math.random()*BAD.length)] : GOOD[Math.floor(Math.random()*GOOD.length)],
        bad,
        spd: 2.0 + g.score * 0.025 + Math.random() * 1.2,
      })
      g.lastSpawn = now
    }

    // 絵文字更新・当たり判定
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const dead = []
    for (let i = g.emojis.length - 1; i >= 0; i--) {
      const em = g.emojis[i]
      em.y += em.spd

      // 背景円（見やすくする）
      ctx.beginPath()
      ctx.arc(em.x, em.y, 28, 0, Math.PI * 2)
      ctx.fillStyle = em.bad ? 'rgba(180,0,0,0.55)' : 'rgba(255,255,255,0.55)'
      ctx.fill()

      // 絵文字本体
      ctx.font = '40px serif'
      ctx.fillText(em.e, em.x, em.y)

      const dx = em.x - g.fx, dy = em.y - g.fy
      if (dx*dx + dy*dy < CATCH_R*CATCH_R) {
        if (em.bad) {
          g.lives = Math.max(0, g.lives - 1)
          setLives(g.lives)
          if (g.lives === 0) {
            g.running = false
            clearInterval(detRef.current)
            cancelAnimationFrame(rafRef.current)
            setPhase('over')
            return
          }
        } else {
          g.score++
          setScore(g.score)
        }
        dead.push(i)
      } else if (em.y > H + 50) {
        dead.push(i)
      }
    }
    dead.forEach(i => g.emojis.splice(i, 1))

    // 顔インジケーター
    ctx.beginPath()
    ctx.arc(g.fx, g.fy, CATCH_R, 0, Math.PI*2)
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.font = '44px serif'
    ctx.fillText('😋', g.fx, g.fy)

    // HUD
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(0, 0, W, 52)
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 22px sans-serif'
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
    ctx.fillText(`スコア: ${g.score}`, 14, 26)
    ctx.textAlign = 'right'
    ctx.fillText('❤️'.repeat(Math.max(0, g.lives)), W - 12, 26)

    rafRef.current = requestAnimationFrame(loop)
  }, [])

  /* ── スタート ── */
  const startGame = async () => {
    setPhase('loading')

    try {
      // 1. カメラ取得
      setDbg('📷 カメラ起動中...')
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: W, height: H },
        audio: false,
      })
      const v = videoRef.current
      v.srcObject = stream

      // 再生開始を確実に待つ
      await new Promise((res, rej) => {
        v.onloadeddata = res
        v.onerror = rej
        v.play().catch(rej)
        setTimeout(res, 3000)  // タイムアウト保険
      })
      setDbg('✅ カメラ起動完了')

      // 2. TF.js + モデル読み込み
      setDbg('🧠 AIモデル読み込み中...')
      await tf.setBackend('webgl')
      await tf.ready()
      modelRef.current = await blazeface.load()
      setDbg('✅ モデル読み込み完了')

      // 3. ゲーム状態リセット
      const g = gRef.current
      Object.assign(g, {
        emojis:[], score:0, lives:3,
        fx:W/2, fy:H/2,
        running:true, detecting:false,
        lastSpawn:0,
      })
      setScore(0); setLives(3)

      // 4. 顔検出ループ開始
      clearInterval(detRef.current)
      detRef.current = setInterval(runDetect, 120)

      setPhase('play')
      requestAnimationFrame(loop)

    } catch(err) {
      console.error(err)
      setDbg(`❌ エラー: ${err.message}`)
      setPhase('error')
    }
  }

  // アンマウント時クリーンアップ
  useEffect(() => () => {
    gRef.current.running = false
    clearInterval(detRef.current)
    cancelAnimationFrame(rafRef.current)
    videoRef.current?.srcObject?.getTracks().forEach(t => t.stop())
  }, [])

  /* ── UI ── */
  const center = {
    width:W, height:H, borderRadius:18,
    background:'#1a1a2e', display:'flex',
    flexDirection:'column', alignItems:'center',
    justifyContent:'center', gap:22,
    maxWidth:'100%',
  }

  return (
    <div style={{
      minHeight:'100vh',
      background:'linear-gradient(135deg,#0f0c29,#302b63,#24243e)',
      display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center',
      fontFamily:'"Helvetica Neue",sans-serif', color:'#fff', padding:16,
    }}>
      <h1 style={{ fontSize:26, fontWeight:800, margin:'0 0 16px' }}>
        😋 絵文字キャッチゲーム
      </h1>

      <div style={{ position:'relative' }}>
        <video ref={videoRef} autoPlay muted playsInline
          style={{ display:'none' }} width={W} height={H} />

        <canvas ref={canvasRef} width={W} height={H}
          style={{
            borderRadius:18, display: phase==='play' ? 'block' : 'none',
            maxWidth:'100%', boxShadow:'0 8px 40px rgba(0,0,0,0.5)',
          }} />

        {/* タイトル */}
        {phase === 'title' && (
          <div style={center}>
            <div style={{ fontSize:72 }}>😋</div>
            <div style={{ textAlign:'center', color:'#ccc', fontSize:15, lineHeight:1.9, maxWidth:360 }}>
              インカメラで顔を認識！<br/>
              降ってくる絵文字に近づけて食べよう！<br/>
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
          <div style={center}>
            <div style={{ fontSize:52 }}>⏳</div>
            <div style={{ fontSize:17, color:'#aaa' }}>{dbg}</div>
          </div>
        )}

        {/* エラー */}
        {phase === 'error' && (
          <div style={center}>
            <div style={{ fontSize:52 }}>😢</div>
            <div style={{ fontSize:15, color:'#ff6b9d', textAlign:'center', maxWidth:360 }}>{dbg}</div>
            <button onClick={() => setPhase('title')} style={{
              background:'#333', border:'none', borderRadius:12,
              padding:'12px 32px', fontSize:15, color:'#fff', cursor:'pointer',
            }}>← 戻る</button>
          </div>
        )}

        {/* ゲームオーバー */}
        {phase === 'over' && (
          <div style={{
            position:'absolute', inset:0, background:'rgba(0,0,0,0.82)',
            borderRadius:18, display:'flex', flexDirection:'column',
            alignItems:'center', justifyContent:'center', gap:20,
          }}>
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

      {/* デバッグ表示 */}
      {phase === 'play' && (
        <p style={{ marginTop:10, fontSize:12, color:'#666' }}>{dbg}</p>
      )}
    </div>
  )
}
