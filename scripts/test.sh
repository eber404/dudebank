set -e

echo "🧪 Running Local Tests..."

docker-compose down --remove-orphans

echo "🏦 Starting Payment Processors..."
cd payment-processor
docker-compose up -d
cd ..

sleep 5

echo "🚀 Starting our application..."
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

sleep 10

echo "🔍 Running basic health checks..."
curl -f http://localhost:9999/payments-summary || echo "❌ Summary endpoint failed"
curl -f http://localhost:8001/payments/service-health || echo "❌ Default processor not ready"
curl -f http://localhost:8002/payments/service-health || echo "❌ Fallback processor not ready"

echo "✅ Basic tests completed!"
