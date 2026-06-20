package com.setminusx.ramsey.ui.redis;

import com.setminusx.ramsey.ui.model.BestResultDto;
import com.setminusx.ramsey.ui.model.LiveStageDto;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.data.redis.core.ZSetOperations;
import tools.jackson.databind.ObjectMapper;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class RedisLiveStageServiceTest {

    private ZSetOperations.TypedTuple<String> tuple(String member, double score) {
        return new org.springframework.data.redis.core.DefaultTypedTuple<>(member, score);
    }

    @Test
    void parses_counts_progress_and_best_results_including_vertex_zero() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked") ValueOperations<String, String> val = mock(ValueOperations.class);
        @SuppressWarnings("unchecked") ZSetOperations<String, String> zset = mock(ZSetOperations.class);
        when(redis.opsForValue()).thenReturn(val);
        when(redis.opsForZSet()).thenReturn(zset);
        when(val.get("processed_count:5")).thenReturn("1500");
        when(val.get("stage_work_index:5")).thenReturn("300");
        when(val.get("stage_config:5")).thenReturn("{\"totalPairs\":600}");

        Set<ZSetOperations.TypedTuple<String>> results = new LinkedHashSet<>();
        results.add(tuple("{\"edgesToFlip\":[{\"vertexOne\":0,\"vertexTwo\":7}]}", 775000));
        results.add(tuple("{\"graphBitstring\":\"0101\"}", 775100));
        when(zset.rangeWithScores("best_results:5", 0, -1)).thenReturn(results);

        RedisLiveStageService svc = new RedisLiveStageService(redis, new ObjectMapper());
        LiveStageDto dto = svc.getLiveStage(5);

        assertThat(dto.processedCount()).isEqualTo(1500);
        assertThat(dto.workIndex()).isEqualTo(300);
        assertThat(dto.totalPairs()).isEqualTo(600);
        assertThat(dto.progressPct()).isEqualTo(50.0);

        List<BestResultDto> best = dto.bestResults();
        assertThat(best).hasSize(2);
        assertThat(best.get(0).cliqueCount()).isEqualTo(775000);
        assertThat(best.get(0).edges()).containsExactly(List.of(0, 7)); // vertex-0 not dropped
        assertThat(best.get(0).fullGraph()).isFalse();
        assertThat(best.get(1).edges()).isEmpty();
        assertThat(best.get(1).fullGraph()).isTrue();
    }

    @Test
    void missing_keys_default_to_zero() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked") ValueOperations<String, String> val = mock(ValueOperations.class);
        @SuppressWarnings("unchecked") ZSetOperations<String, String> zset = mock(ZSetOperations.class);
        when(redis.opsForValue()).thenReturn(val);
        when(redis.opsForZSet()).thenReturn(zset);
        when(zset.rangeWithScores(anyString(), anyLong(), anyLong())).thenReturn(new LinkedHashSet<>());

        RedisLiveStageService svc = new RedisLiveStageService(redis, new ObjectMapper());
        LiveStageDto dto = svc.getLiveStage(9);

        assertThat(dto.processedCount()).isZero();
        assertThat(dto.totalPairs()).isZero();
        assertThat(dto.progressPct()).isZero();
        assertThat(dto.bestResults()).isEmpty();
    }
}
