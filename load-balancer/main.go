package main

import (
	"bytes"
	"context"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	paymentWorkers = 255
	paymentQueueSize = 3000
)

type paymentJob struct {
	backend string
	headers http.Header
	body    *bytes.Buffer
}

type LoadBalancer struct {
	backends     []string
	proxies      map[string]*httputil.ReverseProxy
	clients      map[string]*http.Client
	current      uint64
	paymentQueue chan paymentJob
	bufferPool   sync.Pool
}

func NewLoadBalancer(backends []string) *LoadBalancer {
	proxies := make(map[string]*httputil.ReverseProxy, len(backends))
	clients := make(map[string]*http.Client, len(backends))

	for _, backend := range backends {
		socketPath := backend

		transport := &http.Transport{
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 100, // Aumentado para corresponder a MaxIdleConns
			IdleConnTimeout:     90 * time.Second,
			DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				return net.Dial("unix", socketPath)
			},
		}

		clients[socketPath] = &http.Client{
			Transport: transport,
			Timeout:   10 * time.Second,
		}

		targetURL, _ := url.Parse("http://unix")
		proxy := httputil.NewSingleHostReverseProxy(targetURL)
		proxy.Transport = transport
		proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
			log.Printf("Proxy error to backend %s: %v", socketPath, err)
			w.WriteHeader(http.StatusBadGateway)
		}
		proxies[socketPath] = proxy
	}

	lb := &LoadBalancer{
		backends:     backends,
		proxies:      proxies,
		clients:      clients,
		paymentQueue: make(chan paymentJob, paymentQueueSize),
		bufferPool: sync.Pool{
			New: func() interface{} {
				b := make([]byte, 0, 4*1024) // 4KB
				return bytes.NewBuffer(b)
			},
		},
	}

	lb.startPaymentWorkers()

	return lb
}

func (lb *LoadBalancer) startPaymentWorkers() {
	for i := 0; i < paymentWorkers; i++ {
		go lb.paymentWorker()
	}
}

func (lb *LoadBalancer) paymentWorker() {
	for job := range lb.paymentQueue {
		lb.forwardPayment(job)
	}
}

func (lb *LoadBalancer) getNextBackend() string {
	next := atomic.AddUint64(&lb.current, 1)
	return lb.backends[next%uint64(len(lb.backends))]
}

func (lb *LoadBalancer) handlePayments(w http.ResponseWriter, r *http.Request) {
	bodyBuffer := lb.bufferPool.Get().(*bytes.Buffer)
	bodyBuffer.Reset()
	defer r.Body.Close()

	if _, err := io.Copy(bodyBuffer, r.Body); err != nil {
		log.Printf("Failed to read /payments body: %v", err)
		lb.bufferPool.Put(bodyBuffer)
		w.WriteHeader(http.StatusOK)
		return
	}

	w.WriteHeader(http.StatusOK)

	job := paymentJob{
		backend: lb.getNextBackend(),
		headers: r.Header.Clone(),
		body:    bodyBuffer,
	}

	select {
	case lb.paymentQueue <- job:
	default:
		log.Printf("Payment queue is full. Dropping request for backend %s.", job.backend)
		lb.bufferPool.Put(bodyBuffer)
	}
}

func (lb *LoadBalancer) handleProxy(w http.ResponseWriter, r *http.Request) {
	backend := lb.getNextBackend()
	proxy := lb.proxies[backend]
	proxy.ServeHTTP(w, r)
}

func (lb *LoadBalancer) forwardPayment(job paymentJob) {
	// Devolve o buffer para o pool ao final da função.
	defer lb.bufferPool.Put(job.body)

	client := lb.clients[job.backend]
	req, err := http.NewRequest(http.MethodPost, "http://unix/payments", job.body)
	if err != nil {
		log.Printf("forwardPayment: failed to create request for %s: %v", job.backend, err)
		return
	}

	req.Header = job.headers

	resp, err := client.Do(req)
	if err != nil {
		log.Printf("forwardPayment: failed to send request to %s: %v", job.backend, err)
		return
	}
	defer resp.Body.Close()

	io.Copy(io.Discard, resp.Body)
}

func main() {
	backends := []string{
		"/tmp/api_1.sock",
		"/tmp/api_2.sock",
	}

	lb := NewLoadBalancer(backends)

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/payments" {
			lb.handlePayments(w, r)
			return
		}
		lb.handleProxy(w, r)
	})

	log.Println("Load balancer running on :80")
	log.Printf("Backends via Unix socket: %s", strings.Join(backends, ", "))

	server := &http.Server{
		Addr:    ":80",
		Handler: mux,
	}

	if err := server.ListenAndServe(); err != nil {
		log.Fatal("Server failed:", err)
	}
}