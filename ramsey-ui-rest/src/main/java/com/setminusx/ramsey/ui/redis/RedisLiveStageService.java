package com.setminusx.ramsey.ui.redis;

import com.setminusx.ramsey.ui.model.BestResultDto;
import com.setminusx.ramsey.ui.model.LiveStageDto;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ZSetOperations;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

@Service
public class RedisLiveStageService implements StageCounterReader {

    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;

    public RedisLiveStageService(StringRedisTemplate redis, ObjectMapper objectMapper) {
        this.redis = redis;
        this.objectMapper = objectMapper;
    }

    @Override
    public long readProcessedCount(int stageId) {
        return getProcessedCount(stageId);
    }

    public long getProcessedCount(int stageId) {
        return parseLong(redis.opsForValue().get(StageKeys.PROCESSED_COUNT + stageId));
    }

    public long getWorkIndex(int stageId) {
        return parseLong(redis.opsForValue().get(StageKeys.WORK_INDEX + stageId));
    }

    public long getTotalPairs(int stageId) {
        String json = redis.opsForValue().get(StageKeys.STAGE_CONFIG + stageId);
        if (json == null || json.isBlank()) return 0L;
        try {
            JsonNode node = objectMapper.readTree(json);
            JsonNode tp = node.get("totalPairs");
            return tp != null ? tp.asLong() : 0L;
        } catch (Exception e) {
            return 0L;
        }
    }

    public List<BestResultDto> getBestResults(int stageId) {
        Set<ZSetOperations.TypedTuple<String>> tuples =
                redis.opsForZSet().rangeWithScores(StageKeys.BEST_RESULTS + stageId, 0, -1);
        List<BestResultDto> out = new ArrayList<>();
        if (tuples == null) return out;
        for (ZSetOperations.TypedTuple<String> t : tuples) {
            String member = t.getValue();
            Double score = t.getScore();
            if (member == null || score == null) continue;
            try {
                out.add(parseBestResult(member, score.longValue()));
            } catch (Exception ignored) {
                // skip malformed members
            }
        }
        return out;
    }

    public LiveStageDto getLiveStage(int stageId) {
        long processed = getProcessedCount(stageId);
        long workIndex = getWorkIndex(stageId);
        long totalPairs = getTotalPairs(stageId);
        double pct = totalPairs > 0 ? Math.min(100.0, (workIndex * 100.0) / totalPairs) : 0.0;
        return new LiveStageDto(stageId, processed, workIndex, totalPairs, pct, getBestResults(stageId));
    }

    private BestResultDto parseBestResult(String member, long cliqueCount) {
        JsonNode node = objectMapper.readTree(member);
        List<List<Integer>> edges = new ArrayList<>();
        JsonNode etf = node.get("edgesToFlip");
        if (etf != null && etf.isArray()) {
            for (JsonNode e : etf) {
                Integer u = intOrNull(e, "vertexOne", "vertex_one");
                Integer v = intOrNull(e, "vertexTwo", "vertex_two");
                if (u != null && v != null) edges.add(List.of(u, v)); // 0 is valid
            }
        }
        boolean fullGraph = edges.isEmpty() && node.hasNonNull("graphBitstring");
        return new BestResultDto(cliqueCount, edges, fullGraph);
    }

    private static Integer intOrNull(JsonNode e, String camel, String snake) {
        JsonNode n = e.get(camel);
        if (n == null) n = e.get(snake);
        return (n != null && n.isIntegralNumber()) ? n.asInt() : null;
    }

    private static long parseLong(String s) {
        if (s == null || s.isBlank()) return 0L;
        try { return Long.parseLong(s.trim()); } catch (NumberFormatException e) { return 0L; }
    }
}
