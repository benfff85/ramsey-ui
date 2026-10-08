package com.setminusx.ramsey.ui.redis;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.*;

class RedisLiveStageServiceTest {

    @Test
    void parses_the_campaign_total_and_the_per_stage_count() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked") ValueOperations<String, String> val = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(val);
        when(val.get("processed_total:10")).thenReturn("1373645696523386");
        when(val.get("processed_count:5")).thenReturn(" 1500 ");

        RedisLiveStageService svc = new RedisLiveStageService(redis);

        assertThat(svc.getProcessedTotal(10)).isEqualTo(1_373_645_696_523_386L);
        assertThat(svc.getProcessedCount(5)).isEqualTo(1500L);
        verify(val, never()).get(startsWith("stage_config:"));
    }

    @Test
    void missing_or_garbled_keys_default_to_zero() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked") ValueOperations<String, String> val = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(val);
        when(val.get("processed_total:3")).thenReturn("not-a-number");

        RedisLiveStageService svc = new RedisLiveStageService(redis);

        assertThat(svc.getProcessedTotal(3)).isZero();
        assertThat(svc.getProcessedTotal(99)).isZero();
        assertThat(svc.getProcessedCount(9)).isZero();
    }
}
