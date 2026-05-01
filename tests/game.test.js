import { describe, expect, it } from "vitest";
import {
  addTask,
  calculateCatApproach,
  calculateCatPerspective,
  calculateStats,
  canPetCat,
  completeTask,
  deleteTask,
  failOverdueTasks,
  petCat,
} from "../src/game.js";

const now = new Date("2026-04-29T08:00:00.000Z").getTime();
const future = now + 60_000;
const past = now - 60_000;
const approachDuration = 6_000;
const shortDeadline = now + approachDuration;

function activeTask(overrides = {}) {
  return {
    id: "task-1",
    text: "포트폴리오 정리하기",
    createdAt: now,
    deadlineAt: future,
    status: "active",
    completedAt: null,
    failedAt: null,
    pettedAt: null,
    ...overrides,
  };
}

describe("데드라인 헌터 순수 함수", () => {
  it("빈 텍스트는 추가할 수 없다", () => {
    const tasks = [];

    expect(addTask(tasks, "", future, now)).toBe(tasks);
  });

  it("공백만 있는 텍스트는 추가할 수 없다", () => {
    const tasks = [];

    expect(addTask(tasks, "   ", future, now)).toBe(tasks);
  });

  it("마감 시간이 없으면 추가할 수 없다", () => {
    const tasks = [];

    expect(addTask(tasks, "운동하기", Number.NaN, now)).toBe(tasks);
  });

  it("과거 마감 시간은 추가할 수 없다", () => {
    const tasks = [];

    expect(addTask(tasks, "운동하기", past, now)).toBe(tasks);
  });

  it("정상적인 할 일은 추가되고 원본 배열은 변경하지 않는다", () => {
    const tasks = [];
    const result = addTask(tasks, "  운동하기  ", future, now);

    expect(result).toEqual([
      {
        id: "task-1",
        text: "운동하기",
        createdAt: now,
        deadlineAt: future,
        status: "active",
        completedAt: null,
        failedAt: null,
        pettedAt: null,
      },
    ]);
    expect(tasks).toEqual([]);
  });

  it("기존 id 다음 번호로 새 할 일을 추가한다", () => {
    const tasks = [activeTask({ id: "task-3" })];

    expect(addTask(tasks, "공부하기", future, now).at(-1).id).toBe("task-4");
  });

  it("마감 전 완료하면 상태가 completed가 되고 completedAt이 기록된다", () => {
    const tasks = [activeTask()];
    const result = completeTask(tasks, "task-1", now + 1_000);

    expect(result[0].status).toBe("completed");
    expect(result[0].completedAt).toBe(now + 1_000);
    expect(tasks[0].status).toBe("active");
  });

  it("마감 후 완료는 헬로키티 보상을 발생시키지 않는다", () => {
    const tasks = [activeTask({ deadlineAt: past })];

    expect(completeTask(tasks, "task-1", now)).toBe(tasks);
  });

  it("마감 시간이 지나면 상태가 failed가 되고 failedAt이 기록된다", () => {
    const tasks = [activeTask({ deadlineAt: past })];
    const result = failOverdueTasks(tasks, now);

    expect(result[0].status).toBe("failed");
    expect(result[0].failedAt).toBe(now);
    expect(tasks[0].status).toBe("active");
  });

  it("실패 처리는 중복 적용되지 않는다", () => {
    const failedTask = activeTask({ status: "failed", failedAt: past });
    const tasks = [failedTask];

    expect(failOverdueTasks(tasks, now)).toBe(tasks);
    expect(tasks[0].failedAt).toBe(past);
  });

  it("활성 헬로키티는 마감 시간에 맞춰 계속 다가온다", () => {
    const task = activeTask({ deadlineAt: shortDeadline });

    expect(calculateCatApproach(task, now + 3_000)).toBe(0.5);
  });

  it("완료 버튼은 접근률을 새로 시작하지 않는다", () => {
    const tasks = [activeTask({ deadlineAt: shortDeadline })];
    const completedAt = now + 2_000;
    const completedTasks = completeTask(tasks, "task-1", completedAt);

    expect(calculateCatApproach(tasks[0], completedAt)).toBeCloseTo(1 / 3);
    expect(calculateCatApproach(completedTasks[0], completedAt)).toBeCloseTo(1 / 3);
  });

  it("실패한 헬로키티는 쓰다듬을 수 없다", () => {
    const task = activeTask({ status: "failed", failedAt: now });

    expect(canPetCat(task, shortDeadline, approachDuration)).toBe(false);
  });

  it("완료된 헬로키티가 마감 시간에 도착하면 쓰다듬을 수 있다", () => {
    const task = activeTask({ status: "completed", deadlineAt: shortDeadline, completedAt: now + 1_000 });

    expect(canPetCat(task, shortDeadline, approachDuration)).toBe(true);
  });

  it("쓰다듬으면 pettedAt이 기록되고 상태가 petted가 된다", () => {
    const tasks = [activeTask({ status: "completed", deadlineAt: shortDeadline, completedAt: now + 1_000 })];
    const result = petCat(tasks, "task-1", shortDeadline, approachDuration);

    expect(result[0].status).toBe("petted");
    expect(result[0].pettedAt).toBe(shortDeadline);
    expect(tasks[0].status).toBe("completed");
  });

  it("이미 쓰다듬은 헬로키티는 중복 쓰다듬기 처리되지 않는다", () => {
    const tasks = [activeTask({ status: "petted", completedAt: now, pettedAt: now + approachDuration })];

    expect(petCat(tasks, "task-1", now + approachDuration * 2, approachDuration)).toBe(tasks);
  });

  it("삭제하면 할 일이 제거되고 원본 배열은 변경하지 않는다", () => {
    const tasks = [activeTask(), activeTask({ id: "task-2", text: "물 마시기" })];
    const result = deleteTask(tasks, "task-1");

    expect(result).toEqual([activeTask({ id: "task-2", text: "물 마시기" })]);
    expect(tasks).toHaveLength(2);
  });

  it("헬로키티 원근감 표현 값을 계산한다", () => {
    const task = activeTask({ status: "completed", deadlineAt: shortDeadline, completedAt: now + 1_000 });
    const perspective = calculateCatPerspective(task, now + 4_500, approachDuration);

    expect(perspective.approachRatio).toBe(0.75);
    expect(perspective.scale).toBeGreaterThan(1);
    expect(perspective.translateY).toBeGreaterThan(100);
    expect(perspective.opacity).toBeGreaterThan(0.9);
    expect(perspective.zIndex).toBeGreaterThan(70);
    expect(perspective.shadowStrength).toBeGreaterThan(0.7);
  });

  it("통계 값이 올바르게 계산된다", () => {
    const tasks = [
      activeTask(),
      activeTask({ id: "task-2", status: "completed", completedAt: now }),
      activeTask({ id: "task-3", status: "petted", completedAt: now, pettedAt: now + approachDuration }),
      activeTask({ id: "task-4", status: "failed", failedAt: now }),
    ];

    expect(calculateStats(tasks)).toEqual({
      activeCount: 1,
      completedCount: 2,
      pettedCount: 1,
      returnedCatCount: 1,
    });
  });
});
